'use strict';

(function initInventoryModel(global) {
  const PRODUCT_CATEGORIES = new Set(['Reactivo', 'Consumible', 'Control', 'Calibrador', 'Material', 'Equipo menor', 'Otro']);
  const UNITS = new Set(['unidad', 'frasco', 'caja', 'kit', 'paquete', 'mL', 'L', 'g', 'kg']);
  const MOVEMENT_TYPES = new Set(['in', 'out', 'adjustment', 'discard']);
  const ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;

  const norm = (value) => String(value ?? '').trim();

  const finiteNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : NaN;
  };

  const roundQuantity = (value) => {
    return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
  };

  function uid(prefix = '') {
    const value = global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}${value}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function localDateIso(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function isValidIsoDate(value) {
    if (value === '') return true;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(norm(value));
    if (!match) return false;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
  }

  function isValidIsoDateTime(value) {
    if (!norm(value)) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime());
  }

  function daysUntil(dateValue, today = new Date()) {
    if (!isValidIsoDate(dateValue) || !dateValue) return Infinity;
    const [year, month, day] = dateValue.split('-').map(Number);
    const target = new Date(year, month - 1, day);
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((target.getTime() - base.getTime()) / 86400000);
  }

  function flagsFor(product, warningDays = 90) {
    const active = product?.active !== false;
    const quantity = finiteNumber(product?.quantity);
    const minimum = finiteNumber(product?.minStock);
    const days = daysUntil(norm(product?.expiration));
    return {
      archived: !active,
      expired: active && days < 0,
      zero: active && quantity === 0,
      low: active && quantity > 0 && Number.isFinite(minimum) && quantity <= minimum,
      soon: active && days >= 0 && days <= warningDays,
      days
    };
  }

  function primaryStatus(product, warningDays = 90) {
    const flags = flagsFor(product, warningDays);
    if (flags.archived) return { key: 'archived', label: 'Archivado' };
    if (flags.expired) return { key: 'expired', label: 'Vencido' };
    if (flags.zero) return { key: 'zero', label: 'Agotado' };
    if (flags.low) return { key: 'low', label: 'Stock bajo' };
    if (flags.soon) return { key: 'soon', label: flags.days === 0 ? 'Vence hoy' : `Vence en ${flags.days} días` };
    return { key: 'ok', label: 'Normal' };
  }

  function validateId(value, label = 'ID') {
    const id = norm(value);
    if (!ID_PATTERN.test(id)) throw new Error(`${label} inválido.`);
    return id;
  }

  function boundedText(value, max, label, required = false) {
    const text = norm(value);
    if (required && !text) throw new Error(`${label} es obligatorio.`);
    if (text.length > max) throw new Error(`${label} supera ${max} caracteres.`);
    return text;
  }

  function normalizeProduct(input, existing = null) {
    const now = nowIso();
    const id = validateId(input?.id || existing?.id || uid('PRD-'), 'ID de producto');
    const name = boundedText(input?.name, 120, 'Nombre', true);
    const code = boundedText(input?.code, 50, 'Código', true).toUpperCase();
    const quantity = roundQuantity(finiteNumber(existing ? existing.quantity : input?.quantity));
    const minStock = roundQuantity(finiteNumber(input?.minStock));
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error('La cantidad debe ser un número mayor o igual a cero.');
    if (!Number.isFinite(minStock) || minStock < 0) throw new Error('El stock mínimo debe ser un número mayor o igual a cero.');

    const receivedDate = norm(input?.receivedDate);
    const openedDate = norm(input?.openedDate);
    const expiration = norm(input?.expiration);
    for (const [value, label] of [[receivedDate, 'Fecha de recepción'], [openedDate, 'Fecha de apertura'], [expiration, 'Fecha de caducidad']]) {
      if (!isValidIsoDate(value)) throw new Error(`${label} inválida.`);
    }
    if (receivedDate && openedDate && openedDate < receivedDate) throw new Error('La apertura no puede ser anterior a la recepción.');
    if (receivedDate && expiration && expiration < receivedDate) throw new Error('La caducidad no puede ser anterior a la recepción.');

    const categoryCandidate = norm(input?.category) || 'Otro';
    const unitCandidate = norm(input?.unit) || 'unidad';
    return {
      id,
      name,
      code,
      category: PRODUCT_CATEGORIES.has(categoryCandidate) ? categoryCandidate : 'Otro',
      lot: boundedText(input?.lot, 80, 'Lote'),
      manufacturer: boundedText(input?.manufacturer, 100, 'Fabricante'),
      catalogNumber: boundedText(input?.catalogNumber, 80, 'Número de catálogo'),
      supplier: boundedText(input?.supplier, 100, 'Proveedor'),
      unit: UNITS.has(unitCandidate) ? unitCandidate : 'unidad',
      quantity,
      minStock,
      location: boundedText(input?.location, 100, 'Ubicación'),
      temperature: boundedText(input?.temperature, 80, 'Temperatura'),
      receivedDate,
      openedDate,
      expiration,
      notes: boundedText(input?.notes, 1000, 'Observaciones'),
      active: existing ? existing.active !== false : input?.active !== false,
      createdAt: isValidIsoDateTime(existing?.createdAt || input?.createdAt) ? (existing?.createdAt || input?.createdAt) : now,
      updatedAt: now
    };
  }

  function normalizeImportedProduct(input) {
    const product = normalizeProduct(input, null);
    product.quantity = roundQuantity(finiteNumber(input?.quantity));
    product.active = input?.active !== false;
    product.createdAt = isValidIsoDateTime(input?.createdAt) ? input.createdAt : nowIso();
    product.updatedAt = isValidIsoDateTime(input?.updatedAt) ? input.updatedAt : product.createdAt;
    return product;
  }

  function normalizeMovement(input) {
    const type = norm(input?.type);
    if (!MOVEMENT_TYPES.has(type)) throw new Error('Tipo de movimiento inválido.');
    const quantity = roundQuantity(finiteNumber(input?.quantity));
    if (!Number.isFinite(quantity) || quantity < 0 || (type !== 'adjustment' && quantity <= 0)) throw new Error('Cantidad de movimiento inválida.');
    return {
      id: validateId(input?.id || uid('MOV-'), 'ID de movimiento'),
      productId: validateId(input?.productId, 'Producto del movimiento'),
      productName: boundedText(input?.productName, 120, 'Nombre del producto', true),
      productCode: boundedText(input?.productCode, 50, 'Código del producto', true).toUpperCase(),
      lot: boundedText(input?.lot, 80, 'Lote'),
      type,
      quantity,
      resultingQuantity: input?.resultingQuantity === undefined ? undefined : roundQuantity(finiteNumber(input.resultingQuantity)),
      responsible: boundedText(input?.responsible, 120, 'Responsable', true),
      reason: boundedText(input?.reason, 500, 'Motivo o destino', true),
      createdAt: isValidIsoDateTime(input?.createdAt) ? input.createdAt : nowIso()
    };
  }

  function normalizeAudit(input) {
    return {
      id: validateId(input?.id || uid('AUD-'), 'ID de auditoría'),
      action: boundedText(input?.action, 80, 'Acción', true),
      entityType: boundedText(input?.entityType, 80, 'Tipo de entidad', true),
      entityId: boundedText(input?.entityId, 160, 'ID de entidad'),
      summary: boundedText(input?.summary, 600, 'Detalle', true),
      actor: boundedText(input?.actor || 'Usuario local', 120, 'Responsable', true),
      details: input?.details && typeof input.details === 'object' ? JSON.parse(JSON.stringify(input.details)) : null,
      createdAt: isValidIsoDateTime(input?.createdAt) ? input.createdAt : nowIso()
    };
  }

  function validateBackup(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('El archivo no contiene un respaldo válido.');
    if (payload.schema !== 'lab-inventory-pwa' || ![1, 2, 3].includes(Number(payload.version))) throw new Error('Formato o versión de respaldo no compatible.');
    if (!Array.isArray(payload.products) || !Array.isArray(payload.movements)) throw new Error('El respaldo está incompleto.');

    const productIds = new Set();
    const productCodes = new Set();
    const products = payload.products.map((item, index) => {
      try {
        const product = normalizeImportedProduct(item);
        if (productIds.has(product.id)) throw new Error(`ID duplicado: ${product.id}`);
        if (productCodes.has(product.code)) throw new Error(`Código duplicado: ${product.code}`);
        productIds.add(product.id);
        productCodes.add(product.code);
        return product;
      } catch (error) {
        throw new Error(`Producto ${index + 1}: ${error.message}`);
      }
    });

    const movementIds = new Set();
    const movements = payload.movements.map((item, index) => {
      try {
        const movement = normalizeMovement(item);
        if (movementIds.has(movement.id)) throw new Error(`ID duplicado: ${movement.id}`);
        if (!productIds.has(movement.productId)) throw new Error('El producto relacionado no existe en el respaldo.');
        if (movement.resultingQuantity !== undefined && movement.resultingQuantity !== null && (!Number.isFinite(movement.resultingQuantity) || movement.resultingQuantity < 0)) throw new Error('Saldo resultante inválido.');
        movementIds.add(movement.id);
        return movement;
      } catch (error) {
        throw new Error(`Movimiento ${index + 1}: ${error.message}`);
      }
    });

    const auditIds = new Set();
    const audit = (Array.isArray(payload.audit) ? payload.audit : []).map((item, index) => {
      try {
        const entry = normalizeAudit(item);
        if (auditIds.has(entry.id)) throw new Error(`ID duplicado: ${entry.id}`);
        auditIds.add(entry.id);
        return entry;
      } catch (error) {
        throw new Error(`Auditoría ${index + 1}: ${error.message}`);
      }
    });

    const warningDays = Math.min(730, Math.max(1, Math.trunc(finiteNumber(payload.settings?.warningDays) || 90)));
    return { schema: 'lab-inventory-pwa', version: 3, exportedAt: nowIso(), products, movements, audit, settings: { warningDays } };
  }

  function safeCsvValue(value) {
    const text = String(value ?? '');
    const protectedText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${protectedText.replaceAll('"', '""')}"`;
  }

  function formatNumber(value) {
    const numeric = finiteNumber(value);
    return Number.isFinite(numeric) ? new Intl.NumberFormat('es-CR', { maximumFractionDigits: 4 }).format(numeric) : '—';
  }

  function formatDate(value) {
    if (!isValidIsoDate(value) || !value) return '—';
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium' }).format(new Date(year, month - 1, day));
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  const api = {
    MOVEMENT_TYPES,
    norm,
    uid,
    nowIso,
    localDateIso,
    roundQuantity,
    daysUntil,
    flagsFor,
    primaryStatus,
    normalizeProduct,
    normalizeMovement,
    normalizeAudit,
    validateBackup,
    safeCsvValue,
    formatNumber,
    formatDate,
    formatDateTime
  };

  global.InventoryModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
