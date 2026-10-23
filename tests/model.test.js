'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../js/model.js');

const product = {
  id: 'PRD-1', name: 'Reactivo de prueba', code: 'RX-001',
  quantity: 10, minStock: 2, receivedDate: '2026-01-01',
  openedDate: '', expiration: '2027-01-01'
};
const backup = (products) => ({
  schema: 'lab-inventory-pwa',
  version: 3,
  products,
  movements: [],
  audit: [],
  settings: { warningDays: 90 }
});

test('inventory backup accepts a valid synthetic product without loss of quantities', () => {
  const result = model.validateBackup(backup([product]));
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].quantity, 10);
  assert.equal(result.products[0].code, 'RX-001');
});

test('inventory backup rejects duplicate product identifiers', () => {
  assert.throws(
    () => model.validateBackup(backup([product, { ...product, code: 'RX-002' }])),
    /ID duplicado/
  );
});

test('inventory backup rejects inconsistent expiration dates', () => {
  assert.throws(
    () => model.validateBackup(backup([{ ...product, expiration: '2025-12-31' }])),
    /caducidad/i
  );
});

test('CSV export protects spreadsheet formula prefixes and doubles quotes', () => {
  assert.equal(model.safeCsvValue('=2+3'), '\"\'=2+3\"');
  assert.equal(model.safeCsvValue('   @HYPERLINK'), '\"\'   @HYPERLINK\"');
  assert.equal(model.safeCsvValue('A\"B'), '\"A\"\"B\"');
});
