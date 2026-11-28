import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMedicineDetails } from '../medicine-details.js';
test('old accounts without medicine details remain valid', () => {
  assert.deepEqual(Object.keys(validateMedicineDetails()), []);
});
test('medicine details retain textual strength independently of recorded quantity', () => {
  const details = validateMedicineDetails({ a: { productName: ' Sample ', strength: '0.72 mg／贴', notes: '包装信息' } });
  assert.equal(details.a.productName, 'Sample');
  assert.equal(details.a.strength, '0.72 mg／贴');
  assert.equal(details.a.ingredient, '');
});
test('malformed or oversized medicine details are rejected', () => {
  for (const value of [null, [], { a: null }, { a: { strength: 5 } }, { a: { notes: 'x'.repeat(1001) } }]) {
    assert.throws(() => validateMedicineDetails(value));
  }
});
