'use strict';

const path = require('node:path');
const { canonicalize } = require('./canonical_json');
const { hashCanonical } = require('./hashing');
const {
  loadSchema,
  compileSchema,
  validateDocument
} = require('./schema_validator');
const { validateRuleDefinition } = require('./rule_engine');

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

// The bundle schema admits any JSON number inside `match` and `emit`, but
// canonical JSON is integer-only, so a schema-valid bundle carrying a float or
// an unsafe integer would otherwise fail deep inside hashing with an opaque
// TypeError. Rejecting it here keeps the failure a rule-bundle error and names
// the offending field. Note JSON.parse maps 1.0 to the integer 1, so the
// contract is "integer-valued", not "written without a decimal point".
function validateCanonicalNumbers(value, pointer) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateCanonicalNumbers(item, `${pointer}/${index}`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      validateCanonicalNumbers(value[key], `${pointer}/${key}`);
    }
    return;
  }
  if (typeof value !== 'number') {
    return;
  }
  if (!Number.isInteger(value)) {
    throw new Error(
      `Rule bundle number at ${pointer} must be an integer; canonical JSON does not support floats`
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `Rule bundle number at ${pointer} is outside the safe integer range`
    );
  }
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

    // Every rule is validated, enabled or not: a disabled rule is still hashed
    // into the bundle, so an unsafe pattern must fail at load rather than when
    // the flag is flipped.
    try {
      validateRuleDefinition(rule);
    } catch (error) {
      throw new Error(
        `Rule "${rule.rule_id}" has an invalid match: ${error.message}`,
        { cause: error }
      );
    }
  }

  validateCanonicalNumbers(document, '');

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
    // V8's JSON.parse messages embed a window of the raw source
    // (`Unexpected token 'x', ..."api_key":"secret"... is not valid JSON`), so
    // the parser message is never forwarded. Only the failure class and the
    // path are reported.
    let reason;
    if (error.cause === undefined) {
      reason = error.message;
    } else if (error.cause.code !== undefined) {
      reason = `file cannot be read (${error.cause.code})`;
    } else {
      reason = 'file is not valid JSON';
    }
    throw new Error(
      `Failed to load rule bundle "${bundlePath}": ${reason}`,
      { cause: error }
    );
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
