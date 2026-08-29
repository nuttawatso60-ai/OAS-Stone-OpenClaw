const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rules = require('../data/pricing_rules.json');
const { calculateJobPrice } = require('../tools/pricing_engine');
const { planCustomerResponse, RESPONSE_STATES } = require('../tools/customer_response_planner');

function writeJson(value, fileName) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'response-plan-'));
  const filePath = path.join(directory, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

function evidence() {
  return {
    source_ref: 'chat.txt',
    chunk_id: 'chat.txt:0001',
    message_range: { start: 0, end: 2 }
  };
}

function quotation(quotedPrice, overrides = {}) {
  return {
    id: 'quote_chat_01',
    product_type: 'stone_sign',
    material: 'granite',
    requirements: ['engraving'],
    outcome: 'quoted',
    status: 'draft',
    evidence: evidence(),
    classification: 'observed_quote',
    quoted_price_thb: quotedPrice,
    size: { width: 40, height: 60, unit: 'cm', quantity: 1 },
    ...overrides
  };
}

function styleExample() {
  return {
    id: 'style_price_01',
    topic: 'price',
    example_type: 'price_explanation',
    evidence: evidence(),
    sanitized_example: 'SECRET_PHONE_0800000000 ราคา 9999',
    status: 'reviewed'
  };
}

function fixturePaths({ quotedPrice, styles = [styleExample()] } = {}) {
  const current = calculateJobPrice({
    id: 'fixture', material: 'granite', width_cm: 40, height_cm: 60,
    depth_mm: 3, quantity: 1, complexity: 'standard', rush: false, paint: false, install: false
  }, rules).total;
  return {
    current,
    quotationsPath: writeJson({ schema_version: '1.0', items: [quotation(quotedPrice ?? current)] }, 'quotations.json'),
    responseStylePath: writeJson({ schema_version: '1.0', items: styles }, 'styles.json')
  };
}

function completeRequest(overrides = {}) {
  return { productType: 'stone_sign', material: 'granite', width: 40, height: 60, ...overrides };
}

test('ready response plan includes current pricing, evidence, and style guidance', () => {
  const fixtures = fixturePaths();
  const plan = planCustomerResponse(completeRequest(), fixtures);
  assert.deepEqual(RESPONSE_STATES, ['ready', 'needs_information', 'conflict', 'unsupported']);
  assert.equal(plan.state, 'ready');
  assert.equal(plan.pricing.current.total, fixtures.current);
  assert.equal(plan.facts.historicalQuotations.length, 1);
  assert.equal(plan.responseStyle[0].exampleType, 'price_explanation');
  assert.equal(plan.evidencePointers[0].chunk_id, 'chat.txt:0001');
});

test('missing material returns controlled follow-up information', () => {
  const plan = planCustomerResponse({ productType: 'stone_sign', width: 40, height: 60 });
  assert.equal(plan.state, 'needs_information');
  assert.deepEqual(plan.missingInformation.map(item => item.field), ['material']);
  assert.equal(plan.pricing.current, null);
});

test('missing dimensions returns both dimension follow-ups', () => {
  const plan = planCustomerResponse({ productType: 'stone_sign', material: 'granite' });
  assert.equal(plan.state, 'needs_information');
  assert.deepEqual(plan.missingInformation.map(item => item.field), ['width', 'height']);
});

test('quotation/pricing mismatch is explicit and unresolved', () => {
  const fixtures = fixturePaths({ quotedPrice: 9999 });
  const plan = planCustomerResponse(completeRequest(), fixtures);
  assert.equal(plan.state, 'conflict');
  assert.equal(plan.conflicts[0].conflictType, 'price_mismatch');
  assert.equal(plan.conflicts[0].resolution, null);
  assert.equal(plan.pricing.current.total, fixtures.current);
  assert.equal(plan.pricing.historical[0].quotedPriceThb, 9999);
  assert.notEqual(plan.pricing.current.total, plan.pricing.historical[0].quotedPriceThb);
});

test('historical quotation never overrides pricing-engine output', () => {
  const fixtures = fixturePaths({ quotedPrice: 1 });
  const plan = planCustomerResponse(completeRequest(), fixtures);
  const expected = calculateJobPrice({
    id: 'expected', material: 'granite', width_cm: 40, height_cm: 60,
    depth_mm: 3, quantity: 1, complexity: 'standard', rush: false, paint: false, install: false
  }, rules).total;
  assert.equal(plan.pricing.current.total, expected);
  assert.equal(plan.pricing.authority, 'pricing_engine');
});

test('style examples do not introduce factual pricing or example text', () => {
  const fixtures = fixturePaths();
  const plan = planCustomerResponse(completeRequest(), fixtures);
  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(serialized, /SECRET_PHONE|9999/);
  assert.match(plan.responseStyle[0].guidance, /pricing-engine/);
  assert.equal(plan.responseStyle[0].evidence.chunk_id, 'chat.txt:0001');
});

test('unsupported input fails closed', () => {
  assert.equal(planCustomerResponse({ ...completeRequest(), unit: 'inch' }).state, 'unsupported');
  assert.equal(planCustomerResponse({ ...completeRequest(), unexpected: true }).state, 'unsupported');
});

test('empty datasets still produce a deterministic ready plan', () => {
  const first = planCustomerResponse(completeRequest());
  const second = planCustomerResponse(completeRequest());
  assert.equal(first.state, 'ready');
  assert.deepEqual(first, second);
  assert.deepEqual(first.facts.historicalQuotations, []);
  assert.deepEqual(first.responseStyle, []);
});

test('malformed evidence input fails closed without exposing source content', () => {
  const quotationsPath = writeJson({ invalid: 'SECRET_CHAT_BODY' }, 'bad-quotations.json');
  const plan = planCustomerResponse(completeRequest(), { quotationsPath });
  assert.equal(plan.state, 'unsupported');
  assert.deepEqual(plan.errors, ['invalid_evidence_input']);
  assert.doesNotMatch(JSON.stringify(plan), /SECRET_CHAT_BODY/);
});

test('tracked response-plan datasets contain no raw conversation body or PII', () => {
  for (const file of [
    '../knowledge/datasets/chat_index.json',
    '../knowledge/datasets/quotations.json',
    '../knowledge/datasets/response_style_examples.json'
  ]) {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.doesNotMatch(text, /SECRET_PHONE|messages|ลูกค้า:/);
  }
});
