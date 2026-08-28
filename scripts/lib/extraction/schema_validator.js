'use strict';

const fs = require('node:fs');
const Ajv2020 = require('ajv/dist/2020');

function loadSchema(schemaPath) {
  if (typeof schemaPath !== 'string') {
    throw new TypeError('schemaPath must be a string');
  }
  if (schemaPath.length === 0) {
    throw new Error('schemaPath must not be empty');
  }

  let raw;
  try {
    raw = fs.readFileSync(schemaPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read schema "${schemaPath}": ${error.message}`, { cause: error });
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse schema "${schemaPath}": ${error.message}`, { cause: error });
  }
}

function compileSchema(schema) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true
  });

  try {
    return ajv.compile(schema);
  } catch (error) {
    throw new Error(`Schema compilation failed: ${error.message}`, { cause: error });
  }
}

function validateDocument(document, schemaOrValidator) {
  const validator = typeof schemaOrValidator === 'function'
    ? schemaOrValidator
    : compileSchema(schemaOrValidator);
  const valid = validator(document);
  const errors = valid
    ? []
    : (validator.errors || []).map(error => ({
      ...error,
      params: { ...error.params }
    }));

  return { valid, errors };
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function formatValidationErrors(errors) {
  if (!Array.isArray(errors)) {
    throw new TypeError('errors must be an array');
  }

  return errors
    .map(error => {
      const instancePath = error.instancePath || '/';
      const keyword = error.keyword || 'validation';
      const message = error.message || 'is invalid';
      const params = stableJson(error.params || {});
      return {
        sortKey: [
          instancePath,
          keyword,
          error.schemaPath || '',
          message,
          params
        ].join('\0'),
        text: `${instancePath}: ${message} [${keyword} ${params}]`
      };
    })
    .sort((left, right) => {
      if (left.sortKey < right.sortKey) {
        return -1;
      }
      if (left.sortKey > right.sortKey) {
        return 1;
      }
      return 0;
    })
    .map(error => error.text)
    .join('\n');
}

module.exports = {
  loadSchema,
  compileSchema,
  validateDocument,
  formatValidationErrors
};
