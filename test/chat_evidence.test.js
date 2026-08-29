const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadSchema,
  compileSchema,
  validateDocument
} = require('../scripts/lib/extraction/schema_validator');
const { calculateJobPrice } = require('../tools/pricing_engine');
const {
  buildChatIndex,
  chunkId
} = require('../scripts/build_chat_index');
const {
  buildPricingEvidenceConflicts,
  findQuotationExamples,
  findResponseStyleExamples,
  loadChatIndex,
  loadQuotationExamples,
  loadResponseStyleExamples,
  searchChatChunks
} = require('../tools/chat_evidence');

const schemaDir = path.join(__dirname, '..', 'knowledge', 'datasets', 'schemas');
const rulesPath = path.join(__dirname, '..', 'data', 'pricing_rules.json');

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function processedRecord(sourceRef, messages, status = 'normalized') {
  const content = messages.map(message => `${message.speaker}: ${message.text}`).join('\n');
  return {
    id: `processed_conversation_${sha256(sourceRef).slice(0, 24)}`,
    schema_version: '1.0',
    source_ref: sourceRef,
    source_path: sourceRef,
    content_sha256: sha256(content),
    normalized_at: '2026-08-29T00:00:00.000Z',
    status,
    messages
  };
}

function processedDocument(records) {
  return { schema_version: '1.0', items: records };
}

function writeJson(value, fileName) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-evidence-'));
  const filePath = path.join(directory, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

function validateSchema(fileName, document) {
  const validate = compileSchema(loadSchema(path.join(schemaDir, fileName)));
  return validateDocument(document, validate);
}

function indexedItem(overrides = {}) {
  return {
    id: 'chat_01.txt:0001',
    source_ref: 'chat_01.txt',
    content_sha256: 'a'.repeat(64),
    message_range: { start: 0, end: 2 },
    tags: ['price_quote', 'stone_sign'],
    search_terms: ['40x60', 'ป้ายหิน'],
    date: '2025-02-10',
    status: 'indexed',
    ...overrides
  };
}

function quotation(overrides = {}) {
  return {
    id: 'quote_chat_01',
    product_type: 'stone_sign',
    material: 'granite',
    requirements: ['engraving'],
    outcome: 'quoted',
    status: 'draft',
    evidence: {
      source_ref: 'chat_01.txt',
      chunk_id: 'chat_01.txt:0001',
      message_range: { start: 0, end: 2 }
    },
    classification: 'observed_quote',
    quoted_price_thb: 2500,
    size: { width: 40, height: 60, unit: 'cm', quantity: 1 },
    ...overrides
  };
}

test('chunk IDs are deterministic and source references are retained', () => {
  assert.equal(chunkId('nested/chat 01.txt', 1), 'nested/chat_01.txt:0001');
  const document = processedDocument([
    processedRecord('nested/chat 01.txt', [
      { index: 0, speaker: 'customer', text: 'ชื่อ: คุณสมชาย โทร 0800000000' },
      { index: 1, speaker: 'agent', text: 'ขอขนาดก่อนเสนอราคา' }
    ])
  ]);
  const index = buildChatIndex(document);
  assert.deepEqual(index.items[0].message_range, { start: 0, end: 1 });
  assert.equal(index.items[0].source_ref, 'nested/chat 01.txt');
  assert.equal(index.items[0].content_sha256, document.items[0].content_sha256);
});

test('repeated and reordered builds are byte-stable without duplicates', () => {
  const first = processedRecord('chat_02.txt', [{ index: 0, speaker: 'customer', text: 'ป้ายหิน' }]);
  const second = processedRecord('chat_01.txt', [{ index: 0, speaker: 'customer', text: 'ขอราคา' }]);
  const document = processedDocument([first, second]);
  const built = JSON.stringify(buildChatIndex(document));
  assert.equal(JSON.stringify(buildChatIndex(document)), built);
  assert.equal(JSON.stringify(buildChatIndex(processedDocument([second, first]))), built);
  assert.equal(new Set(JSON.parse(built).items.map(item => item.id)).size, 2);
});

test('empty processed evidence is indexed as unparsed without losing its source', () => {
  const index = buildChatIndex(processedDocument([processedRecord('empty.txt', [], 'empty')]));
  assert.equal(index.items[0].status, 'unparsed');
  assert.deepEqual(index.items[0].message_range, { start: 0, end: 0 });
});

test('malformed processed input fails promotion safely', () => {
  assert.throws(() => buildChatIndex({ schema_version: '1.0', items: [{ source_ref: 'bad.txt' }] }), /schema validation/);
});

test('chat index has no conversation body or obvious PII', () => {
  const secret = 'SECRET_PHONE_0800000000';
  const index = buildChatIndex(processedDocument([
    processedRecord('chat.txt', [{ index: 0, speaker: 'customer', text: `ชื่อ: สมชาย ${secret}` }])
  ]));
  const serialized = JSON.stringify(index);
  assert.doesNotMatch(serialized, /SECRET_PHONE|0800000000|messages|สมชาย/);
});

test('chat index schema validates pointers and rejects invalid ranges', () => {
  assert.equal(validateSchema('chat_index.schema.json', { schema_version: '1.0', items: [indexedItem()] }).valid, true);
  const invalid = { schema_version: '1.0', items: [{ ...indexedItem(), message_range: { start: -1, end: 2 } }] };
  assert.equal(validateSchema('chat_index.schema.json', invalid).valid, false);
});

test('chat search applies exact terms/tags, date filters, and a bound', () => {
  const index = {
    schema_version: '1.0',
    items: [
      indexedItem(),
      indexedItem({ id: 'chat_02.txt:0001', source_ref: 'chat_02.txt', date: '2025-03-01', search_terms: ['40x60'] }),
      indexedItem({ id: 'chat_03.txt:0001', source_ref: 'chat_03.txt', date: '2025-02-10' })
    ]
  };
  assert.equal(searchChatChunks({ index, terms: ['40x60'], tags: ['price_quote'], dateFrom: '2025-02-01', dateTo: '2025-02-28' }).length, 2);
  assert.equal(searchChatChunks({ index, terms: ['not-present'] }).length, 0);
  assert.equal(searchChatChunks({ index, limit: 1 }).length, 1);
});

test('quotation schema requires evidence for chat classification and validates quote/size', () => {
  assert.equal(validateSchema('quotations.schema.json', { schema_version: '1.0', items: [quotation()] }).valid, true);
  for (const invalid of [
    { ...quotation(), classification: 'bad' },
    { ...quotation(), quoted_price_thb: 0 },
    { ...quotation(), size: { width: 0, height: 60, unit: 'cm' } },
    { ...quotation(), size: { width: 40, height: 60, unit: 'm' } },
    { ...quotation(), evidence: undefined, classification: 'observed_quote' }
  ]) {
    assert.equal(validateSchema('quotations.schema.json', { schema_version: '1.0', items: [invalid] }).valid, false);
  }
});

test('quotation retrieval returns only exact relevant records', () => {
  const quotations = { schema_version: '1.0', items: [
    quotation(),
    quotation({ id: 'quote_chat_02', material: 'marble', size: { width: 30, height: 20, unit: 'cm', quantity: 1 } })
  ] };
  assert.deepEqual(findQuotationExamples({ quotations, material: 'granite', width: 40, height: 60 }).map(item => item.id), ['quote_chat_01']);
  assert.deepEqual(findQuotationExamples({ quotations, productType: 'not-found' }), []);
});

test('response style retrieval filters by topic/type and retains evidence', () => {
  const examples = { schema_version: '1.0', items: [{
    id: 'style_price_01', topic: 'price', example_type: 'price_explanation',
    evidence: quotation().evidence, sanitized_example: 'แจ้งราคาโดยระบุเงื่อนไข', status: 'reviewed'
  }, {
    id: 'style_close_01', topic: 'closing', example_type: 'closing',
    evidence: quotation().evidence, sanitized_example: 'ยืนยันแบบก่อนเริ่มงาน', status: 'candidate'
  }] };
  assert.deepEqual(findResponseStyleExamples({ examples, topic: 'price', exampleType: 'price_explanation' }).map(item => item.id), ['style_price_01']);
  assert.equal(findResponseStyleExamples({ examples, topic: 'price' })[0].evidence.chunk_id, 'chat_01.txt:0001');
  assert.equal(validateSchema('response_style_examples.schema.json', examples).valid, true);
});

test('loaders validate tracked datasets and return empty initial data', () => {
  assert.deepEqual(loadChatIndex().items, []);
  assert.deepEqual(loadQuotationExamples().items, []);
  assert.deepEqual(loadResponseStyleExamples().items, []);
});

test('conflict builder reports historical versus engine values and keeps resolution null', () => {
  const conflicts = buildPricingEvidenceConflicts({ quotations: { schema_version: '1.0', items: [quotation()] } });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].conflictType, 'price_mismatch');
  assert.equal(conflicts[0].resolution, null);
  assert.equal(typeof conflicts[0].engine.total, 'number');
  assert.equal(conflicts[0].evidence.chunk_id, 'chat_01.txt:0001');
});

test('insufficient conditions do not invent an engine result', () => {
  const conflicts = buildPricingEvidenceConflicts({ quotations: {
    schema_version: '1.0', items: [{ ...quotation(), id: 'quote_missing', quoted_price_thb: undefined, material: undefined, size: undefined }]
  } });
  assert.equal(conflicts[0].conflictType, 'insufficient_conditions');
  assert.equal('engine' in conflicts[0], false);
});

test('pricing rules remain unchanged while building conflicts', () => {
  const before = fs.readFileSync(rulesPath);
  buildPricingEvidenceConflicts({ quotations: { schema_version: '1.0', items: [quotation()] } });
  assert.deepEqual(fs.readFileSync(rulesPath), before);
  assert.equal(calculateJobPrice({ id: 'test', material: 'granite', width_cm: 40, height_cm: 60, depth_mm: 3, quantity: 1, complexity: 'standard' }, JSON.parse(before)).total > 0, true);
});
