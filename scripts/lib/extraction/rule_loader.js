'use strict';

const path = require('node:path');
const { canonicalize } = require('./canonical_json');
const { hashCanonical } = require('./hashing');
const {
  loadSchema,
  compileSchema,
  validateDocument
} = require('./schema_validator');

const RULE_BUNDLE_HASH_DOMAIN = 'rule_bundle:v1:';
const RULE_BUNDLE_SCHEMA_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'knowledge',
  'datasets',
  'schemas',
  'rule_bundle.schema.json'
);

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function summarizeValidationErrors(errors) {
  return errors
    .map(error => `${error.instancePath || '/'} [${error.keyword}]`)
    .sort(compareCodeUnits)
    .join(', ');
}

function validateRuleSemantics(document) {
  const seenRuleIds = new Set();

  for (const rule of document.rules) {
    if (seenRuleIds.has(rule.rule_id)) {
      throw new Error(`Rule bundle contains duplicate rule_id "${rule.rule_id}"`);
    }
    seenRuleIds.add(rule.rule_id);

    if (!Number.isInteger(rule.rule_version) || rule.rule_version < 1) {
      throw new Error(`Rule "${rule.rule_id}" has an invalid rule_version`);
    }
  }

  for (let index = 1; index < document.rules.length; index += 1) {
    const previous = document.rules[index - 1].rule_id;
    const current = document.rules[index].rule_id;
    if (compareCodeUnits(previous, current) >= 0) {
      throw new Error('Rule bundle rules must be strictly sorted by rule_id');
    }
  }
}

function loadRuleBundle(bundlePath) {
  let document;
  try {
    document = loadSchema(bundlePath);
  } catch (error) {
    throw new Error(`Failed to load rule bundle: ${error.message}`, { cause: error });
  }

  const schema = loadSchema(RULE_BUNDLE_SCHEMA_PATH);
  const validator = compileSchema(schema);
  const validation = validateDocument(document, validator);
  if (!validation.valid) {
    const summary = summarizeValidationErrors(validation.errors);
    throw new Error(`Rule bundle schema validation failed: ${summary}`);
  }

  validateRuleSemantics(document);

  // Parsing canonical JSON creates a normalized deep copy without changing
  // the loaded document. It also normalizes strings to NFC and object keys
  // into deterministic code-unit order.
  const normalized = JSON.parse(canonicalize(document));

  return {
    schema_version: normalized.schema_version,
    dataset: normalized.dataset,
    rules: normalized.rules,
    bundle_sha256: hashCanonical(RULE_BUNDLE_HASH_DOMAIN, document)
  };
}

module.exports = {
  loadRuleBundle
};
