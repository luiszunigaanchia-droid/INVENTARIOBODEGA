'use strict';

(function initInventoryDatabase(global) {
  const DB_NAME = 'bodega2InventoryDB';
  const DB_VERSION = 3;
  const CHANGE_KEY = 'bodega2-inventory-change';
  let dbPromise = null;
  const listeners = new Set();
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bodega2-inventory-db') : null;

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Error de IndexedDB.'));
    });
  }

  function ensureIndex(store, name, keyPath, options = {}) {
    if (!store.indexNames.contains(name)) {
      store.createIndex(name, keyPath, options);
    }
  }

  function openDB() {
    if (dbPromise) {
      return dbPromise;
    }
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const tx = request.transaction;

        let products;
        if (!db.objectStoreNames.contains('products')) {
          products = db.createObjectStore('products', { keyPath: 'id' });
        } else {
          products = tx.objectStore('products');
        }
        ensureIndex(products, 'code', 'code', { unique: true });
        ensureIndex(products, 'name', 'name');
        ensureIndex(products, 'active', 'active');
        ensureIndex(products, 'expiration', 'expiration');

        let movements;
        if (!db.objectStoreNames.contains('movements')) {
          movements = db.createObjectStore('movements', { keyPath: 'id' });
        } else {
          movements = tx.objectStore('movements');
        }
        ensureIndex(movements, 'createdAt', 'createdAt');
        ensureIndex(movements, 'productId', 'productId');
        ensureIndex(movements, 'type', 'type');

        let audit;
        if (!db.objectStoreNames.contains('audit')) {
          audit = db.createObjectStore('audit', { keyPath: 'id' });
        } else {
          audit = tx.objectStore('audit');
        }
        ensureIndex(audit, 'createdAt', 'createdAt');
        ensureIndex(audit, 'entityId', 'entityId');
        ensureIndex(audit, 'action', 'action');

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('No se pudo abrir IndexedDB.'));
      };
      request.onblocked = () => reject(new Error('La base está bloqueada por otra pestaña. Cierre otras pestañas de la aplicación y vuelva a intentarlo.'));
    });
    return dbPromise;
  }

  async function runTransaction(storeNames, mode, worker) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      const stores = Object.fromEntries(storeNames.map(name => [name, tx.objectStore(name)]));
      let result;
      try {
        result = worker(stores, tx);
      } catch (error) {
        try { tx.abort(); } catch (_) {}
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Error de base de datos.'));
      tx.onabort = () => reject(tx.error || new Error('Transacción cancelada.'));
    });
  }

  function notifyChange(kind = 'data') {
    const message = { kind, at: Date.now() };
    channel?.postMessage(message);
    try { localStorage.setItem(CHANGE_KEY, JSON.stringify(message)); } catch (_) {}
    listeners.forEach(listener => {
      try { listener(message); } catch (_) {}
    });
  }

  channel?.addEventListener('message', event => listeners.forEach(listener => {
    try { listener(event.data); } catch (_) {}
  }));
  global.addEventListener?.('storage', event => {
    if (event.key !== CHANGE_KEY || !event.newValue) return;
    let message = { kind: 'data', at: Date.now() };
    try { message = JSON.parse(event.newValue); } catch (_) {}
    listeners.forEach(listener => {
      try { listener(message); } catch (_) {}
    });
  });

  function onChange(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function getAll(storeName) {
    const db = await openDB();
    return requestPromise(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
  }

  async function getOne(storeName, key) {
    const db = await openDB();
    return requestPromise(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
  }

  async function getSetting(key) {
    return (await getOne('settings', key))?.value;
  }

  async function setSetting(key, value) {
    await runTransaction(['settings'], 'readwrite', stores => stores.settings.put({ key, value }));
    notifyChange('settings');
  }

  function auditRecord(input) {
    return InventoryModel.normalizeAudit(input);
  }

  async function createProduct(product, audit, initialMovement = null) {
    const stores = initialMovement ? ['products', 'movements', 'audit'] : ['products', 'audit'];
    await runTransaction(stores, 'readwrite', objectStores => {
      objectStores.products.add(product);
      if (initialMovement) objectStores.movements.add(initialMovement);
      objectStores.audit.add(auditRecord(audit));
    });
    notifyChange('products');
  }

  async function updateProduct(product, audit) {
    await runTransaction(['products', 'audit'], 'readwrite', stores => {
      stores.products.put(product);
      stores.audit.add(auditRecord(audit));
    });
    notifyChange('products');
  }

  async function setProductActive(productId, active, audit) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['products', 'audit'], 'readwrite');
      const products = tx.objectStore('products');
      const request = products.get(productId);
      let customError = null;
      request.onsuccess = () => {
        const product = request.result;
        if (!product) {
          customError = new Error('Producto no encontrado.');
          tx.abort();
          return;
        }
        product.active = Boolean(active);
        product.updatedAt = audit.createdAt;
        products.put(product);
        tx.objectStore('audit').add(auditRecord(audit));
      };
      request.onerror = () => {
        customError = request.error || new Error('No se pudo consultar el producto.');
        tx.abort();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(customError || tx.error || new Error('No se pudo actualizar el producto.'));
      tx.onabort = () => reject(customError || tx.error || new Error('Transacción cancelada.'));
    });
    notifyChange('products');
  }

  async function applyMovement(movement, audit) {
    const db = await openDB();
    let resultingQuantity;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['products', 'movements', 'audit'], 'readwrite');
      const products = tx.objectStore('products');
      const request = products.get(movement.productId);
      let customError = null;
      request.onsuccess = () => {
        const product = request.result;
        if (!product) {
          customError = new Error('Producto no encontrado.');
          tx.abort();
          return;
        }
        if (product.active === false) {
          customError = new Error('El producto está archivado.');
          tx.abort();
          return;
        }
        const quantity = Number(movement.quantity);
        let next = Number(product.quantity);
        if (movement.type === 'in') next += quantity;
        else if (movement.type === 'adjustment') next = quantity;
        else next -= quantity;
        next = InventoryModel.roundQuantity(next);
        if (!Number.isFinite(next) || next < 0) {
          customError = new Error('La cantidad supera el stock disponible.');
          tx.abort();
          return;
        }
        resultingQuantity = next;
        product.quantity = next;
        product.updatedAt = movement.createdAt;
        products.put(product);
        tx.objectStore('movements').add({ ...movement, resultingQuantity: next });
        tx.objectStore('audit').add(auditRecord({ ...audit, details: { ...(audit.details || {}), resultingQuantity: next } }));
      };
      request.onerror = () => {
        customError = request.error || new Error('No se pudo consultar el producto.');
        tx.abort();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(customError || tx.error || new Error('No se pudo guardar el movimiento.'));
      tx.onabort = () => reject(customError || tx.error || new Error('Transacción cancelada.'));
    });
    notifyChange('movements');
    return resultingQuantity;
  }

  async function replaceAll(data, audit) {
    await runTransaction(['products', 'movements', 'audit', 'settings'], 'readwrite', stores => {
      stores.products.clear();
      stores.movements.clear();
      stores.audit.clear();
      data.products.forEach(item => stores.products.add(item));
      data.movements.forEach(item => stores.movements.add(item));
      data.audit.forEach(item => stores.audit.add(item));
      stores.audit.add(auditRecord(audit));
      stores.settings.put({ key: 'warningDays', value: data.settings.warningDays });
      stores.settings.put({ key: 'lastRestore', value: audit.createdAt });
    });
    notifyChange('restore');
  }

  async function clearAll(audit) {
    await runTransaction(['products', 'movements', 'audit', 'settings'], 'readwrite', stores => {
      stores.products.clear();
      stores.movements.clear();
      stores.audit.clear();
      stores.settings.clear();
      stores.audit.add(auditRecord(audit));
    });
    notifyChange('clear');
  }

  global.InventoryDB = {
    openDB,
    getAll,
    getOne,
    getSetting,
    setSetting,
    createProduct,
    updateProduct,
    setProductActive,
    applyMovement,
    replaceAll,
    clearAll,
    onChange
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
