'use strict';

const $ = id => document.getElementById(id);
const M = InventoryModel;
const state = {
  products: [],
  movements: [],
  audit: [],
  tab: 'inventory',
  warningDays: 90,
  installPrompt: null,
  refreshing: false,
  refreshTimer: null
};

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.title) node.title = options.title;
  if (options.type) node.type = options.type;
  if (options.colSpan) node.colSpan = options.colSpan;
  if (options.dataset) Object.entries(options.dataset).forEach(([key, value]) => { node.dataset[key] = value; });
  if (options.attrs) Object.entries(options.attrs).forEach(([key, value]) => node.setAttribute(key, value));
  const list = Array.isArray(children) ? children : [children];
  list.filter(Boolean).forEach(child => node.append(child));
  return node;
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = String(value ?? '');
}

function toast(message) {
  const node = $('toast');
  if (!node) return;
  node.textContent = String(message || '');
  node.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.add('hidden'), 3800);
}

function setBusy(form, busy) {
  form?.querySelectorAll('button, input, select, textarea').forEach(control => {
    if (control.type !== 'hidden') control.disabled = Boolean(busy);
  });
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    const [products, movements, audit, warningDays] = await Promise.all([
      InventoryDB.getAll('products'),
      InventoryDB.getAll('movements'),
      InventoryDB.getAll('audit'),
      InventoryDB.getSetting('warningDays')
    ]);
    state.products = Array.isArray(products) ? products : [];
    state.movements = Array.isArray(movements) ? movements : [];
    state.audit = Array.isArray(audit) ? audit : [];
    state.warningDays = Math.min(730, Math.max(1, Math.trunc(Number(warningDays) || 90)));
    state.products.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
    state.movements.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    state.audit.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    renderAll();
  } finally {
    state.refreshing = false;
  }
}

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => refresh().catch(error => console.error(error)), 120);
}

function renderAll() {
  renderMetrics();
  renderInventory();
  renderMovements();
  renderAudit();
  fillMovementProducts();
  setText('soonMetricLabel', `Vencen en ${state.warningDays} días`);
  const warningInput = $('warningDays');
  if (warningInput && document.activeElement !== warningInput) warningInput.value = String(state.warningDays);
}

function renderMetrics() {
  const active = state.products.filter(product => product.active !== false);
  let low = 0;
  let zero = 0;
  let expired = 0;
  let soon = 0;
  active.forEach(product => {
    const flags = M.flagsFor(product, state.warningDays);
    if (flags.low) low += 1;
    if (flags.zero) zero += 1;
    if (flags.expired) expired += 1;
    if (flags.soon) soon += 1;
  });
  setText('mTotal', active.length);
  setText('mLow', low);
  setText('mZero', zero);
  setText('mExpired', expired);
  setText('mSoon', soon);
}

function productMatchesFilter(product, filter) {
  const flags = M.flagsFor(product, state.warningDays);
  if (filter === 'all') return product.active !== false;
  return Boolean(flags[filter]);
}

function filteredProducts() {
  const query = M.norm($('search')?.value).toLocaleLowerCase('es');
  const filter = $('filter')?.value || 'all';
  return state.products.filter(product => {
    if (!productMatchesFilter(product, filter)) return false;
    if (!query) return true;
    return [product.name, product.code, product.lot, product.location, product.category, product.manufacturer, product.catalogNumber, product.supplier, product.temperature, product.notes]
      .some(value => String(value || '').toLocaleLowerCase('es').includes(query));
  });
}

function cellWithPrimaryAndSecondary(primary, secondary = '') {
  const cell = element('td');
  cell.append(element('strong', { text: primary || '—' }));
  if (secondary) cell.append(element('br'), element('small', { text: secondary }));
  return cell;
}

function actionButton(symbol, label, action, productId) {
  return element('button', {
    className: 'icon-btn',
    text: symbol,
    title: label,
    type: 'button',
    dataset: { act: action, id: productId },
    attrs: { 'aria-label': label }
  });
}

function renderInventory() {
  const body = $('inventoryBody');
  if (!body) return;
  body.replaceChildren();
  const products = filteredProducts();
  setText('inventoryCount', `${products.length} registro${products.length === 1 ? '' : 's'}`);
  products.forEach(product => {
    const status = M.primaryStatus(product, state.warningDays);
    const row = element('tr', { className: product.active === false ? 'row-muted' : '' });
    row.append(
      cellWithPrimaryAndSecondary(product.code),
      cellWithPrimaryAndSecondary(product.name, [product.category, product.manufacturer].filter(Boolean).join(' · ')),
      element('td', { text: product.lot || '—' }),
      element('td', { text: product.location || '—' }),
      cellWithPrimaryAndSecondary(`${M.formatNumber(product.quantity)} ${product.unit || ''}`.trim(), `Mínimo: ${M.formatNumber(product.minStock)}`),
      element('td', { text: M.formatDate(product.expiration) }),
      element('td', {}, element('span', { className: `badge ${status.key}`, text: status.label })),
      element('td', {}, element('div', { className: 'actions' }, [
        actionButton('⌕', 'Ver detalle', 'view', product.id),
        product.active === false ? null : actionButton('↕', 'Registrar movimiento', 'move', product.id),
        actionButton('✎', 'Editar producto', 'edit', product.id),
        actionButton(product.active === false ? '↩' : '⌫', product.active === false ? 'Reactivar producto' : 'Archivar producto', 'archive', product.id)
      ].filter(Boolean)))
    );
    body.appendChild(row);
  });
  $('inventoryEmpty')?.classList.toggle('hidden', products.length > 0);
}

function filteredMovements() {
  const query = M.norm($('movementSearch')?.value).toLocaleLowerCase('es');
  const type = $('movementFilter')?.value || 'all';
  return state.movements.filter(movement => {
    if (type !== 'all' && movement.type !== type) return false;
    if (!query) return true;
    return [movement.productName, movement.productCode, movement.lot, movement.responsible, movement.reason]
      .some(value => String(value || '').toLocaleLowerCase('es').includes(query));
  });
}

const MOVEMENT_LABELS = { in: 'Entrada', out: 'Salida', adjustment: 'Ajuste', discard: 'Baja' };

function renderMovements() {
  const body = $('movementsBody');
  if (!body) return;
  body.replaceChildren();
  const movements = filteredMovements();
  setText('movementCount', `${movements.length} movimiento${movements.length === 1 ? '' : 's'}`);
  movements.forEach(movement => {
    const row = element('tr');
    row.append(
      element('td', { text: M.formatDateTime(movement.createdAt) }),
      cellWithPrimaryAndSecondary(movement.productName || 'Producto', [movement.productCode, movement.lot ? `lote ${movement.lot}` : ''].filter(Boolean).join(' · ')),
      element('td', {}, element('span', { className: `badge ${movement.type}`, text: MOVEMENT_LABELS[movement.type] || movement.type })),
      element('td', { text: M.formatNumber(movement.quantity) }),
      element('td', { text: movement.resultingQuantity === undefined ? '—' : M.formatNumber(movement.resultingQuantity) }),
      element('td', { text: movement.responsible || '—' }),
      element('td', { text: movement.reason || '—' })
    );
    body.appendChild(row);
  });
  $('movementsEmpty')?.classList.toggle('hidden', movements.length > 0);
}

function renderAudit() {
  const body = $('auditBody');
  if (!body) return;
  body.replaceChildren();
  setText('auditCount', `${state.audit.length} registro${state.audit.length === 1 ? '' : 's'}`);
  state.audit.forEach(entry => {
    const row = element('tr');
    row.append(
      element('td', { text: M.formatDateTime(entry.createdAt) }),
      element('td', {}, element('span', { className: 'badge audit', text: entry.action || '—' })),
      cellWithPrimaryAndSecondary(entry.entityType || '—', entry.entityId || ''),
      element('td', { text: entry.actor || 'Usuario local' }),
      element('td', { text: entry.summary || '—' })
    );
    body.appendChild(row);
  });
  $('auditEmpty')?.classList.toggle('hidden', state.audit.length > 0);
}

function fillMovementProducts() {
  const select = $('movProduct');
  if (!select) return;
  const current = select.value;
  const products = state.products.filter(product => product.active !== false);
  select.replaceChildren(element('option', { text: 'Seleccione…', attrs: { value: '' } }));
  products.forEach(product => {
    const option = element('option', { text: `${product.code} — ${product.name}${product.lot ? ` · ${product.lot}` : ''} (${M.formatNumber(product.quantity)} ${product.unit})` });
    option.value = product.id;
    select.appendChild(option);
  });
  if (products.some(product => product.id === current)) select.value = current;
  updateMovementHint();
}

function setInput(id, value) {
  const input = $(id);
  if (input) input.value = value ?? '';
}

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function openProduct(id = '') {
  const product = state.products.find(item => item.id === id) || null;
  $('productForm')?.reset();
  setText('productTitle', product ? 'Editar producto/lote' : 'Nuevo producto/lote');
  setInput('productId', product?.id || '');
  const defaults = { category: 'Reactivo', unit: 'unidad', quantity: 0, minStock: 1 };
  ['name', 'code', 'category', 'lot', 'manufacturer', 'catalogNumber', 'supplier', 'unit', 'quantity', 'minStock', 'location', 'temperature', 'receivedDate', 'openedDate', 'expiration', 'notes']
    .forEach(key => setInput(key, product?.[key] ?? defaults[key] ?? ''));
  $('quantity').disabled = Boolean(product);
  setText('quantityHelp', product ? 'La existencia solo cambia mediante movimientos o ajustes.' : 'La existencia inicial quedará registrada como ajuste inicial.');
  openDialog($('productDialog'));
  setTimeout(() => $('name')?.focus(), 0);
}

function openMovement(id = '') {
  const products = state.products.filter(product => product.active !== false);
  if (products.length === 0) return toast('Primero registre un producto activo.');
  $('movementForm')?.reset();
  fillMovementProducts();
  if (id && products.some(product => product.id === id)) $('movProduct').value = id;
  setInput('movType', 'out');
  setInput('movQuantity', '1');
  const previousResponsible = localStorage.getItem('bodega2-inventory-responsible');
  if (previousResponsible) setInput('movResponsible', previousResponsible);
  updateMovementHint();
  openDialog($('movementDialog'));
}

function openDetail(id) {
  const product = state.products.find(item => item.id === id);
  if (!product) return;
  setText('detailTitle', `${product.code} — ${product.name}`);
  const list = $('detailList');
  list.replaceChildren();
  const status = M.primaryStatus(product, state.warningDays);
  const fields = [
    ['Estado', status.label],
    ['Categoría', product.category || '—'],
    ['Lote', product.lot || '—'],
    ['Fabricante', product.manufacturer || '—'],
    ['N.º catálogo', product.catalogNumber || '—'],
    ['Proveedor', product.supplier || '—'],
    ['Existencia', `${M.formatNumber(product.quantity)} ${product.unit || ''}`.trim()],
    ['Stock mínimo', M.formatNumber(product.minStock)],
    ['Ubicación', product.location || '—'],
    ['Temperatura', product.temperature || '—'],
    ['Recepción', M.formatDate(product.receivedDate)],
    ['Apertura', M.formatDate(product.openedDate)],
    ['Caducidad', M.formatDate(product.expiration)],
    ['Observaciones', product.notes || '—'],
    ['Última actualización', M.formatDateTime(product.updatedAt)]
  ];
  fields.forEach(([label, value]) => list.append(element('dt', { text: label }), element('dd', { text: value })));
  openDialog($('detailDialog'));
}

function productPayloadFromForm() {
  return {
    id: $('productId').value || M.uid('PRD-'),
    name: $('name').value,
    code: $('code').value,
    category: $('category').value,
    lot: $('lot').value,
    manufacturer: $('manufacturer').value,
    catalogNumber: $('catalogNumber').value,
    supplier: $('supplier').value,
    unit: $('unit').value,
    quantity: $('quantity').value,
    minStock: $('minStock').value,
    location: $('location').value,
    temperature: $('temperature').value,
    receivedDate: $('receivedDate').value,
    openedDate: $('openedDate').value,
    expiration: $('expiration').value,
    notes: $('notes').value
  };
}

async function saveProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.checkValidity()) return form.reportValidity();
  const id = $('productId').value;
  const existing = state.products.find(item => item.id === id) || null;
  let product;
  try {
    product = M.normalizeProduct(productPayloadFromForm(), existing);
  } catch (error) {
    return toast(error.message);
  }
  const duplicate = state.products.find(item => item.id !== product.id && String(item.code || '').toUpperCase() === product.code);
  if (duplicate) return toast(`El código ${product.code} ya está registrado.`);

  setBusy(form, true);
  try {
    const timestamp = M.nowIso();
    const audit = {
      id: M.uid('AUD-'),
      action: existing ? 'actualización' : 'creación',
      entityType: 'producto',
      entityId: product.id,
      summary: `${existing ? 'Actualizado' : 'Creado'} ${product.code} — ${product.name}`,
      createdAt: timestamp
    };
    if (existing) {
      await InventoryDB.updateProduct(product, audit);
    } else {
      let initialMovement = null;
      if (product.quantity > 0) {
        initialMovement = M.normalizeMovement({
          id: M.uid('MOV-'),
          productId: product.id,
          productName: product.name,
          productCode: product.code,
          lot: product.lot,
          type: 'adjustment',
          quantity: product.quantity,
          resultingQuantity: product.quantity,
          responsible: 'Usuario local',
          reason: 'Existencia inicial al crear el producto',
          createdAt: timestamp
        });
      }
      await InventoryDB.createProduct(product, audit, initialMovement);
    }
    closeDialog($('productDialog'));
    toast(existing ? 'Producto actualizado.' : 'Producto registrado.');
    await refresh();
  } catch (error) {
    toast(error?.name === 'ConstraintError' ? 'El código interno ya existe.' : error.message || 'No se pudo guardar el producto.');
  } finally {
    setBusy(form, false);
  }
}

function updateMovementHint() {
  const product = state.products.find(item => item.id === $('movProduct')?.value);
  const type = $('movType')?.value;
  if (!product) return setText('movementHint', '');
  setText('movementHint', type === 'adjustment'
    ? `Existencia actual: ${M.formatNumber(product.quantity)} ${product.unit}. La cantidad ingresada será el nuevo saldo.`
    : `Existencia disponible: ${M.formatNumber(product.quantity)} ${product.unit}.`);
}

async function saveMovement(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.checkValidity()) return form.reportValidity();
  const product = state.products.find(item => item.id === $('movProduct').value);
  if (!product) return toast('Seleccione un producto.');
  let movement;
  try {
    movement = M.normalizeMovement({
      id: M.uid('MOV-'),
      productId: product.id,
      productName: product.name,
      productCode: product.code,
      lot: product.lot,
      type: $('movType').value,
      quantity: $('movQuantity').value,
      responsible: $('movResponsible').value,
      reason: $('movReason').value,
      createdAt: M.nowIso()
    });
  } catch (error) {
    return toast(error.message);
  }
  localStorage.setItem('bodega2-inventory-responsible', movement.responsible);
  setBusy(form, true);
  try {
    await InventoryDB.applyMovement(movement, {
      id: M.uid('AUD-'),
      action: 'movimiento',
      entityType: 'inventario',
      entityId: product.id,
      actor: movement.responsible,
      summary: `${MOVEMENT_LABELS[movement.type]} de ${M.formatNumber(movement.quantity)} ${product.unit} en ${product.code}`,
      details: { movementId: movement.id, type: movement.type, quantity: movement.quantity },
      createdAt: movement.createdAt
    });
    closeDialog($('movementDialog'));
    toast('Movimiento guardado.');
    await refresh();
  } catch (error) {
    toast(error.message || 'No se pudo guardar el movimiento.');
  } finally {
    setBusy(form, false);
  }
}

async function toggleArchive(id) {
  const product = state.products.find(item => item.id === id);
  if (!product) return;
  const activate = product.active === false;
  if (!activate && Number(product.quantity) > 0 && !confirm(`El producto conserva ${M.formatNumber(product.quantity)} ${product.unit}. ¿Archivarlo de todos modos?`)) return;
  try {
    const timestamp = M.nowIso();
    await InventoryDB.setProductActive(id, activate, {
      id: M.uid('AUD-'),
      action: activate ? 'reactivación' : 'archivo',
      entityType: 'producto',
      entityId: id,
      summary: `${activate ? 'Reactivado' : 'Archivado'} ${product.code} — ${product.name}`,
      createdAt: timestamp
    });
    toast(activate ? 'Producto reactivado.' : 'Producto archivado.');
    await refresh();
  } catch (error) {
    toast(error.message || 'No se pudo cambiar el estado del producto.');
  }
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  ['inventory', 'movements', 'audit', 'backup'].forEach(name => $(`${name}Panel`)?.classList.toggle('hidden', name !== tab));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportBackup() {
  const data = {
    schema: 'lab-inventory-pwa',
    version: 3,
    exportedAt: M.nowIso(),
    settings: { warningDays: state.warningDays },
    products: state.products,
    movements: state.movements,
    audit: state.audit
  };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `respaldo-inventario-${M.localDateIso()}.json`);
  const timestamp = M.nowIso();
  localStorage.setItem('bodega2-inventory-last-backup', timestamp);
  await InventoryDB.setSetting('lastBackup', timestamp);
  await updateBackupText();
  toast('Respaldo JSON generado.');
}

function csvBlob(header, rows) {
  const content = '\uFEFF' + [header, ...rows].map(row => row.map(M.safeCsvValue).join(',')).join('\r\n');
  return new Blob([content], { type: 'text/csv;charset=utf-8' });
}

function exportMovementsCsv() {
  const header = ['Fecha', 'Código', 'Producto', 'Lote', 'Tipo', 'Cantidad', 'Saldo resultante', 'Responsable', 'Motivo/Destino'];
  const rows = filteredMovements().map(movement => [movement.createdAt, movement.productCode, movement.productName, movement.lot, MOVEMENT_LABELS[movement.type] || movement.type, movement.quantity, movement.resultingQuantity ?? '', movement.responsible, movement.reason]);
  downloadBlob(csvBlob(header, rows), `movimientos-inventario-${M.localDateIso()}.csv`);
  toast('CSV de movimientos generado.');
}

function exportInventoryCsv() {
  const header = ['Código', 'Producto', 'Categoría', 'Lote', 'Fabricante', 'Catálogo', 'Proveedor', 'Unidad', 'Cantidad', 'Stock mínimo', 'Ubicación', 'Temperatura', 'Recepción', 'Apertura', 'Caducidad', 'Estado', 'Observaciones'];
  const rows = state.products.map(product => [product.code, product.name, product.category, product.lot, product.manufacturer, product.catalogNumber, product.supplier, product.unit, product.quantity, product.minStock, product.location, product.temperature, product.receivedDate, product.openedDate, product.expiration, M.primaryStatus(product, state.warningDays).label, product.notes]);
  downloadBlob(csvBlob(header, rows), `inventario-bodega-${M.localDateIso()}.csv`);
  toast('CSV de inventario generado.');
}

async function importBackup(file) {
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('El respaldo supera el límite de 20 MB.');
    const data = M.validateBackup(JSON.parse(await file.text()));
    const message = `Se reemplazarán los datos actuales por ${data.products.length} productos, ${data.movements.length} movimientos y ${data.audit.length} registros de auditoría. ¿Continuar?`;
    if (!confirm(message)) return;
    const timestamp = M.nowIso();
    await InventoryDB.replaceAll(data, {
      id: M.uid('AUD-'),
      action: 'restauración',
      entityType: 'sistema',
      entityId: 'database',
      summary: `Restaurado respaldo con ${data.products.length} productos y ${data.movements.length} movimientos`,
      createdAt: timestamp
    });
    toast('Respaldo restaurado correctamente.');
    await refresh();
  } catch (error) {
    toast(error.message || 'No se pudo importar el respaldo.');
  } finally {
    $('importInput').value = '';
  }
}

async function loadDemo() {
  if (state.products.length && !confirm('Se agregarán datos de ejemplo al inventario actual. ¿Continuar?')) return;
  const samples = [
    { code: 'REA-GLU-01', name: 'Reactivo de glucosa', category: 'Reactivo', lot: 'GLU-2607', unit: 'frasco', quantity: 8, minStock: 3, location: 'Refrigerador 1', temperature: '2–8 °C', expiration: '2027-02-28' },
    { code: 'CON-HBA1C', name: 'Control HbA1c', category: 'Control', lot: 'HBA-118', unit: 'kit', quantity: 2, minStock: 2, location: 'Refrigerador 2', temperature: '2–8 °C', expiration: '2026-09-15' },
    { code: 'GUANTE-M', name: 'Guantes nitrilo M', category: 'Consumible', lot: 'GN-440', unit: 'caja', quantity: 12, minStock: 5, location: 'Estante B2', temperature: 'Ambiente', expiration: '' }
  ];
  let created = 0;
  for (const sample of samples) {
    if (state.products.some(product => String(product.code).toUpperCase() === sample.code)) continue;
    const timestamp = M.nowIso();
    const product = M.normalizeProduct({ ...sample, id: M.uid('PRD-'), notes: 'Dato de ejemplo' });
    const movement = M.normalizeMovement({ id: M.uid('MOV-'), productId: product.id, productName: product.name, productCode: product.code, lot: product.lot, type: 'adjustment', quantity: product.quantity, resultingQuantity: product.quantity, responsible: 'Usuario local', reason: 'Existencia inicial de dato de ejemplo', createdAt: timestamp });
    await InventoryDB.createProduct(product, { id: M.uid('AUD-'), action: 'creación', entityType: 'producto', entityId: product.id, summary: `Creado dato de ejemplo ${product.code}`, createdAt: timestamp }, movement);
    created += 1;
  }
  toast(created ? `${created} datos de ejemplo agregados.` : 'Los datos de ejemplo ya existen.');
  await refresh();
}

async function clearData() {
  if (!confirm('Esta acción borrará inventario, movimientos y auditoría. ¿Continuar?')) return;
  if (!confirm('Confirmación final: esta acción no se puede deshacer sin un respaldo.')) return;
  const timestamp = M.nowIso();
  await InventoryDB.clearAll({ id: M.uid('AUD-'), action: 'borrado total', entityType: 'sistema', entityId: 'database', summary: 'Se borraron todos los datos locales', createdAt: timestamp });
  toast('Datos eliminados.');
  await refresh();
}

function updateNetwork() {
  const online = navigator.onLine;
  setText('networkStatus', online ? 'En línea' : 'Sin conexión');
  $('networkStatus').className = `status ${online ? 'online' : 'offline'}`;
}

async function updateBackupText() {
  const value = localStorage.getItem('bodega2-inventory-last-backup') || await InventoryDB.getSetting('lastBackup');
  setText('lastBackup', value ? `Último respaldo exportado: ${M.formatDateTime(value)}` : 'No se ha registrado una exportación en este dispositivo.');
}

async function updateStorageStatus() {
  if (!navigator.storage?.persisted) return setText('storageStatus', 'El navegador no permite consultar la persistencia del almacenamiento.');
  try {
    const persisted = await navigator.storage.persisted();
    const estimate = await navigator.storage.estimate?.();
    const used = Number.isFinite(estimate?.usage) ? `${(estimate.usage / 1024 / 1024).toFixed(2)} MB utilizados.` : '';
    const quota = Number.isFinite(estimate?.quota) ? ` Cuota estimada: ${(estimate.quota / 1024 / 1024).toFixed(0)} MB.` : '';
    setText('storageStatus', `${persisted ? 'Almacenamiento persistente activado.' : 'Almacenamiento no persistente; mantenga respaldos externos.'} ${used}${quota}`.trim());
  } catch (_) {
    setText('storageStatus', 'No se pudo consultar el estado del almacenamiento.');
  }
}

async function requestPersistence() {
  if (!navigator.storage?.persist) return toast('El navegador no permite solicitar almacenamiento persistente.');
  const granted = await navigator.storage.persist();
  toast(granted ? 'Almacenamiento persistente concedido.' : 'El navegador no concedió persistencia.');
  await updateStorageStatus();
}

async function saveSettings() {
  const value = Math.trunc(Number($('warningDays').value));
  if (!Number.isFinite(value) || value < 1 || value > 730) return toast('Ingrese entre 1 y 730 días.');
  await InventoryDB.setSetting('warningDays', value);
  state.warningDays = value;
  renderAll();
  toast('Configuración guardada.');
}

function bind() {
  $('addProductBtn').addEventListener('click', () => openProduct());
  $('movementBtn').addEventListener('click', () => openMovement());
  $('search').addEventListener('input', renderInventory);
  $('filter').addEventListener('change', renderInventory);
  $('movementSearch').addEventListener('input', renderMovements);
  $('movementFilter').addEventListener('change', renderMovements);
  $('movProduct').addEventListener('change', updateMovementHint);
  $('movType').addEventListener('change', updateMovementHint);
  $('productForm').addEventListener('submit', saveProduct);
  $('movementForm').addEventListener('submit', saveMovement);
  document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target === dialog) closeDialog(dialog);
  }));
  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  $('inventoryBody').addEventListener('click', event => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const { act, id } = button.dataset;
    if (act === 'view') openDetail(id);
    if (act === 'edit') openProduct(id);
    if (act === 'move') openMovement(id);
    if (act === 'archive') toggleArchive(id);
  });
  $('exportBtn').addEventListener('click', () => exportBackup().catch(error => toast(error.message)));
  $('csvBtn').addEventListener('click', exportMovementsCsv);
  $('inventoryCsvBtn').addEventListener('click', exportInventoryCsv);
  $('importInput').addEventListener('change', event => event.target.files?.[0] && importBackup(event.target.files[0]));
  $('persistBtn').addEventListener('click', requestPersistence);
  $('demoBtn').addEventListener('click', loadDemo);
  $('clearBtn').addEventListener('click', clearData);
  $('saveSettingsBtn').addEventListener('click', saveSettings);
  window.addEventListener('online', updateNetwork);
  window.addEventListener('offline', updateNetwork);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.installPrompt = event;
    $('installBtn').classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    $('installBtn').classList.add('hidden');
  });
  $('installBtn').addEventListener('click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice.catch(() => null);
    state.installPrompt = null;
    $('installBtn').classList.add('hidden');
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.register('./sw.js');
  const showUpdate = () => $('updateBanner').classList.remove('hidden');
  if (registration.waiting && navigator.serviceWorker.controller) showUpdate();
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
    });
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  $('reloadBtn').addEventListener('click', () => {
    if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  });
}

(async function start() {
  try {
    bind();
    updateNetwork();
    await InventoryDB.openDB();
    InventoryDB.onChange(scheduleRefresh);
    await Promise.all([refresh(), updateBackupText(), updateStorageStatus(), registerServiceWorker()]);
  } catch (error) {
    console.error(error);
    toast(error.message || 'No se pudo iniciar la aplicación.');
  }
})();
