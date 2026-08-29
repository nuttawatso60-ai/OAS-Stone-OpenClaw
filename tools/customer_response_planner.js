'use strict';

const { calculateJobPrice } = require('./pricing_engine');
const {
  buildPricingEvidenceConflicts,
  findQuotationExamples,
  findResponseStyleExamples,
  loadResponseStyleExamples,
  loadRules,
  loadQuotationExamples
} = require('./chat_evidence');

const RESPONSE_STATES = Object.freeze(['ready', 'needs_information', 'conflict', 'unsupported']);
const ALLOWED_REQUEST_FIELDS = new Set([
  'query', 'productType', 'material', 'width', 'height', 'unit', 'quantity',
  'depthMm', 'complexity', 'rush', 'paint', 'install', 'topic', 'exampleType'
]);
const STYLE_GUIDANCE = Object.freeze({
  question_sequence: 'Use the reviewed question sequence as a style reference.',
  price_explanation: 'Explain the current pricing-engine result before historical context.',
  negotiation: 'Use the reviewed negotiation example as a style reference only.',
  objection_response: 'Use the reviewed objection-response example as a style reference only.',
  closing: 'Use the reviewed closing example as a style reference only.',
  terminology: 'Prefer reviewed shop terminology without adding factual claims.'
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function basePlan(request, state, errors = []) {
  return {
    version: 1,
    state,
    request,
    facts: { historicalQuotations: [] },
    pricing: { authority: 'pricing_engine', current: null, historical: [] },
    responseStyle: [],
    missingInformation: [],
    conflicts: [],
    evidencePointers: [],
    errors
  };
}

function unsupportedPlan(request, code) {
  return basePlan(request, 'unsupported', [code]);
}

function normalizeRequest(request) {
  if (!isPlainObject(request)) return { error: 'invalid_request' };
  if (Object.keys(request).some(key => !ALLOWED_REQUEST_FIELDS.has(key))) {
    return { error: 'unsupported_request_field' };
  }

  const normalized = {};
  for (const key of ['query', 'productType', 'material', 'complexity', 'topic', 'exampleType']) {
    if (request[key] !== undefined) {
      if (typeof request[key] !== 'string' || request[key].trim() === '') {
        return { error: `invalid_${key}` };
      }
      normalized[key] = request[key].normalize('NFC').trim();
    }
  }
  if (request.unit !== undefined && request.unit !== 'cm') return { error: 'unsupported_unit' };
  if (request.unit !== undefined) normalized.unit = request.unit;
  for (const key of ['width', 'height', 'depthMm']) {
    if (request[key] !== undefined) {
      if (typeof request[key] !== 'number' || !Number.isFinite(request[key]) || request[key] <= 0) {
        return { error: `invalid_${key}` };
      }
      normalized[key] = request[key];
    }
  }
  if (request.quantity !== undefined) {
    if (!Number.isSafeInteger(request.quantity) || request.quantity < 1) return { error: 'invalid_quantity' };
    normalized.quantity = request.quantity;
  } else {
    normalized.quantity = 1;
  }
  for (const key of ['rush', 'paint', 'install']) {
    if (request[key] !== undefined) {
      if (typeof request[key] !== 'boolean') return { error: `invalid_${key}` };
      normalized[key] = request[key];
    }
  }
  return { request: normalized };
}

function missingInformation(request) {
  const missing = [];
  if (!request.productType) missing.push({ field: 'productType', question: 'What product or job type is needed?' });
  if (!request.material) missing.push({ field: 'material', question: 'Which material should be used?' });
  if (request.width === undefined) missing.push({ field: 'width', question: 'What is the width in cm?' });
  if (request.height === undefined) missing.push({ field: 'height', question: 'What is the height in cm?' });
  return missing;
}

function pointerKey(pointer) {
  return JSON.stringify(pointer);
}

function evidencePointers(quotations, styles) {
  const pointers = [];
  for (const item of [...quotations, ...styles]) {
    if (!item.evidence) continue;
    const pointer = {
      source_ref: item.evidence.source_ref,
      chunk_id: item.evidence.chunk_id,
      message_range: item.evidence.message_range
    };
    if (!pointers.some(existing => pointerKey(existing) === pointerKey(pointer))) pointers.push(pointer);
  }
  return pointers;
}

function mapHistoricalQuotation(item) {
  return {
    id: item.id,
    productType: item.product_type,
    material: item.material,
    size: item.size,
    quotedPriceThb: item.quoted_price_thb,
    classification: item.classification,
    evidence: item.evidence
  };
}

function mapResponseStyle(item) {
  return {
    topic: item.topic,
    exampleType: item.example_type,
    guidance: STYLE_GUIDANCE[item.example_type],
    evidence: item.evidence
  };
}

function planCustomerResponse(request, {
  quotationsPath,
  responseStylePath,
  rulesPath,
  limit = 5
} = {}) {
  const normalized = normalizeRequest(request);
  if (normalized.error) return unsupportedPlan({}, normalized.error);
  const input = normalized.request;
  const missing = missingInformation(input);
  const plan = basePlan(input, missing.length > 0 ? 'needs_information' : 'ready');
  plan.missingInformation = missing;

  let quotations;
  let styles;
  let rules;
  try {
    quotations = loadQuotationExamples(quotationsPath);
    styles = loadResponseStyleExamples(responseStylePath);
    rules = loadRules(rulesPath);
  } catch (error) {
    return unsupportedPlan(input, 'invalid_evidence_input');
  }

  const styleItems = findResponseStyleExamples({
    examples: styles,
    topic: input.topic ?? (missing.length === 0 ? 'price' : input.topic),
    exampleType: input.exampleType ?? (missing.length === 0 ? 'price_explanation' : input.exampleType),
    limit
  });
  plan.responseStyle = styleItems.map(mapResponseStyle);

  if (missing.length > 0) {
    plan.evidencePointers = evidencePointers([], styleItems);
    return plan;
  }

  let current;
  try {
    current = calculateJobPrice({
      id: 'CUSTOMER-RESPONSE-PLAN',
      material: input.material,
      width_cm: input.width,
      height_cm: input.height,
      depth_mm: input.depthMm ?? 3,
      quantity: input.quantity,
      complexity: input.complexity ?? 'standard',
      rush: input.rush ?? false,
      paint: input.paint ?? false,
      install: input.install ?? false
    }, rules);
  } catch (error) {
    return unsupportedPlan(input, error.message.includes('.material is unknown:') ? 'unknown_material' : 'unsupported_pricing_conditions');
  }
  plan.pricing.current = {
    total: current.total,
    currency: 'THB',
    assumptions: {
      depthMm: input.depthMm ?? 3,
      complexity: input.complexity ?? 'standard',
      rush: input.rush ?? false,
      paint: input.paint ?? false,
      install: input.install ?? false
    }
  };

  const quotationItems = findQuotationExamples({
    quotations,
    productType: input.productType,
    material: input.material,
    width: input.width,
    height: input.height,
    quantity: input.quantity,
    limit
  });
  plan.facts.historicalQuotations = quotationItems.map(mapHistoricalQuotation);
  plan.pricing.historical = plan.facts.historicalQuotations.map(item => ({
    quotationId: item.id,
    quotedPriceThb: item.quotedPriceThb,
    evidence: item.evidence
  }));
  plan.conflicts = buildPricingEvidenceConflicts({
    quotations: { schema_version: '1.0', items: quotationItems },
    rules
  });
  plan.evidencePointers = evidencePointers(quotationItems, styleItems);
  if (plan.conflicts.length > 0) plan.state = 'conflict';
  return plan;
}

module.exports = {
  RESPONSE_STATES,
  planCustomerResponse
};
