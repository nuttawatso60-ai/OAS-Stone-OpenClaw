const test = require('node:test');
const assert = require('node:assert/strict');
const {
  StaffPricingInputError,
  parsePriceCommand,
  quoteStaffPrice
} = require('../tools/staff_pricing');

test('parses staff price command with default quantity', () => {
  assert.deepEqual(parsePriceCommand('/price granite 30x20'), {
    material: 'granite', widthCm: 30, heightCm: 20, quantity: 1
  });
});

test('parses Thai material aliases and explicit quantity', () => {
  assert.deepEqual(parsePriceCommand('/price แกรนิต 40x25 2'), {
    material: 'granite', widthCm: 40, heightCm: 25, quantity: 2
  });
});

test('parses the supported English price forms', () => {
  assert.deepEqual(parsePriceCommand('/price granite 30x20 2'), {
    material: 'granite', widthCm: 30, heightCm: 20, quantity: 2
  });
});

test('rejects malformed size, unknown material, and non-integer quantity', () => {
  assert.throws(() => parsePriceCommand('/price granite 30-20'), StaffPricingInputError);
  assert.throws(() => parsePriceCommand('/price granite 0x20'), StaffPricingInputError);
  assert.throws(() => parsePriceCommand('/price granite 30x0'), StaffPricingInputError);
  assert.throws(() => parsePriceCommand('/price wood 30x20'), StaffPricingInputError);
  assert.throws(() => parsePriceCommand('/price granite 30x20 0'), StaffPricingInputError);
  assert.throws(() => parsePriceCommand('/price granite 30x20 -1'), StaffPricingInputError);
  assert.throws(() => parsePriceCommand('/price granite 30x20 1.5'), StaffPricingInputError);
});

test('formats deterministic quote without exposing raw pricing coefficients', () => {
  const text = quoteStaffPrice('/price granite 30x20 2');
  assert.match(text, /รวมประมาณ:/);
  assert.match(text, /ค่าวัสดุ:/);
  assert.match(text, /ค่า CNC:/);
  assert.match(text, /depth 3 mm/);
  assert.equal(text.includes('base_per_cm2'), false);
  assert.equal(text.includes('cnc_rate_per_minute'), false);
});

test('uses the pricing engine deterministically with standard assumptions', () => {
  const first = quoteStaffPrice('/price แกรนิต 40x25 2');
  const second = quoteStaffPrice('/price granite 40x25 2');

  assert.equal(first, second);
  assert.match(first, /รวมประมาณ: 3,348\.00 บาท/);
});
