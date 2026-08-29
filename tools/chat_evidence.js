'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { calculateJobPrice } = require('./pricing_engine');
const {
  loadSchema,
  compileSchema,
  validateDocument,
  formatValidationErrors
} = require('../scripts/lib/extraction/schema_validator');

const WORKSPACE_DIR = path.resolve(__dirname, '..');
const DEFAULT_CHAT_INDEX_PATH = path.join(WORKSPACE_DIR, 'knowledge', 'datasets', 'chat_index.json');
const DEFAULT_QUOTATIONS_PATH = path.join(WORKSPACE_DIR, 'knowledge', 'datasets', 'quotations.json');
const DEFAULT_RESPONSE_STYLE_PATH = path.join(WORKSPACE_DIR, 'knowledge', 'datasets', 'response_style_examples.json');
const DEFAULT_RULES_PATH = path.join(WORKSPACE_DIR, 'data', 'pricing_rules.json');
const SCHEMA_DIR = path.join(WORKSPACE_DIR, 'knowledge', 'datasets', 'schemas');

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} unavailable`);
  }
}

function loadValidated(filePath, schemaName, label) {
  const document = readJson(filePath, label);
  const schema = loadSchema(path.join(SCHEMA_DIR, schemaName));
  const result = validateDocument(document, compileSchema(schema));
  if (!result.valid) {
    throw new Error(`${label} invalid: ${formatValidationErrors(result.errors)}`);
  }
  return document;
}

function normalizeTerm(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.normalize('NFC').trim().toLowerCase();
}

function asDocument(value, name) {
  if (Array.isArray(value)) return { items: value };
  if (!value || !Array.isArray(value.items)) throw new TypeError(`${name} must contain items`);
  return value;
}

function loadChatIndex(filePath = DEFAULT_CHAT_INDEX_PATH) {
  return loadValidated(filePath, 'chat_index.schema.json', 'chat index');
}

function searchChatChunks({ index = loadChatIndex(), terms = [], tags = [], dateFrom, dateTo, limit = 20 } = {}) {
  const document = asDocument(index, 'index');
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('limit must be a positive safe integer');
  const wantedTerms = terms.map((term, index) => normalizeTerm(term, `terms[${index}]`));
  const wantedTags = tags.map((tag, index) => normalizeTerm(tag, `tags[${index}]`));
  return document.items.filter(item => {
    const itemTerms = new Set(item.search_terms.map(normalizeTerm));
    const itemTags = new Set(item.tags.map(normalizeTerm));
    if (!wantedTerms.every(term => itemTerms.has(term))) return false;
    if (!wantedTags.every(tag => itemTags.has(tag))) return false;
    if (dateFrom !== undefined && (!item.date || item.date < dateFrom)) return false;
    if (dateTo !== undefined && (!item.date || item.date > dateTo)) return false;
    return true;
  }).slice(0, limit);
}

function loadQuotationExamples(filePath = DEFAULT_QUOTATIONS_PATH) {
  return loadValidated(filePath, 'quotations.schema.json', 'quotation examples');
}

function findQuotationExamples({
  quotations = loadQuotationExamples(),
  productType,
  material,
  width,
  height,
  quantity,
  classification,
  limit = 20
} = {}) {
  const items = asDocument(quotations, 'quotations').items;
  return items.filter(item => {
    if (productType !== undefined && item.product_type !== productType) return false;
    if (material !== undefined && item.material !== material) return false;
    if (classification !== undefined && item.classification !== classification) return false;
    if (width !== undefined && item.size?.width !== width) return false;
    if (height !== undefined && item.size?.height !== height) return false;
    if (quantity !== undefined && item.size?.quantity !== quantity) return false;
    return true;
  }).slice(0, limit);
}

function loadResponseStyleExamples(filePath = DEFAULT_RESPONSE_STYLE_PATH) {
  return loadValidated(filePath, 'response_style_examples.schema.json', 'response style examples');
}

function findResponseStyleExamples({
  examples = loadResponseStyleExamples(),
  topic,
  exampleType,
  limit = 20
} = {}) {
  const items = asDocument(examples, 'response style examples').items;
  return items.filter(item => (topic === undefined || item.topic === topic)
    && (exampleType === undefined || item.example_type === exampleType)).slice(0, limit);
}

function loadRules(filePath = DEFAULT_RULES_PATH) {
  return readJson(filePath, 'pricing rules');
}

function buildPricingEvidenceConflicts({ quotations = loadQuotationExamples(), rules = loadRules() } = {}) {
  return asDocument(quotations, 'quotations').items.flatMap(quotation => {
    const size = quotation.size;
    const historical = {
      quoted_price_thb: quotation.quoted_price_thb,
      size,
      material: quotation.material
    };
    const base = {
      quotationId: quotation.id,
      evidence: quotation.evidence,
      historical,
      resolution: null
    };
    if (typeof quotation.quoted_price_thb !== 'number' || !size || typeof quotation.material !== 'string') {
      return [{ ...base, conflictType: 'insufficient_conditions' }];
    }
    if (size.unit !== 'cm' || !Number.isFinite(size.width) || !Number.isFinite(size.height)) {
      return [{ ...base, conflictType: 'unsupported_dimension' }];
    }

    let engine;
    try {
      engine = calculateJobPrice({
        id: quotation.id,
        material: quotation.material,
        width_cm: size.width,
        height_cm: size.height,
        depth_mm: 3,
        quantity: size.quantity ?? 1,
        complexity: 'standard',
        rush: false,
        paint: false,
        install: false
      }, rules);
    } catch (error) {
      if (error.message.includes('.material is unknown:')) {
        return [{ ...base, conflictType: 'unknown_material' }];
      }
      return [{ ...base, conflictType: 'insufficient_conditions' }];
    }

    if (engine.total === quotation.quoted_price_thb) return [];
    return [{
      ...base,
      engine: { total: engine.total, currency: 'THB' },
      delta_thb: quotation.quoted_price_thb - engine.total,
      conflictType: 'price_mismatch'
    }];
  });
}

module.exports = {
  DEFAULT_CHAT_INDEX_PATH,
  DEFAULT_QUOTATIONS_PATH,
  DEFAULT_RESPONSE_STYLE_PATH,
  buildPricingEvidenceConflicts,
  findQuotationExamples,
  findResponseStyleExamples,
  loadChatIndex,
  loadRules,
  loadQuotationExamples,
  loadResponseStyleExamples,
  searchChatChunks
};
