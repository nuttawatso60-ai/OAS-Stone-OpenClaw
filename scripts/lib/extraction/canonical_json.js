'use strict';

function fail(message) {
  throw new TypeError(`Canonical JSON error: ${message}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoSymbolProperties(value) {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('symbol properties are not supported');
  }
}

function serializeString(value) {
  return JSON.stringify(value.normalize('NFC'));
}

function serializeNumber(value) {
  if (!Number.isFinite(value)) {
    fail('NaN and Infinity are not supported');
  }
  if (!Number.isInteger(value)) {
    fail('floating-point numbers are not supported');
  }
  // Unsafe integers (|n| > 2^53 - 1) lose precision and can serialize in
  // scientific notation (e.g. 1e21 -> "1e+21"), so they are rejected.
  if (!Number.isSafeInteger(value)) {
    fail('integers outside the safe integer range are not supported');
  }
  // Negative zero serializes as "0"; -0 and 0 are canonically equal.
  return JSON.stringify(value);
}

function serializeArray(value, seen) {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedNames = new Set(['length']);

  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    expectedNames.add(key);
    if (!Object.prototype.hasOwnProperty.call(descriptors, key)) {
      fail('sparse arrays are not supported');
    }
  }

  for (const name of Object.getOwnPropertyNames(value)) {
    if (!expectedNames.has(name)) {
      fail('arrays with custom properties are not supported');
    }
  }

  assertNoSymbolProperties(value);

  const items = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor.enumerable || descriptor.get || descriptor.set) {
      fail('arrays with non-enumerable or accessor elements are not supported');
    }
    items.push(serializeValue(descriptor.value, seen));
  }

  return `[${items.join(',')}]`;
}

function serializeObject(value, seen) {
  if (!isPlainObject(value)) {
    fail('only plain objects are supported');
  }

  assertNoSymbolProperties(value);

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.getOwnPropertyNames(value);

  for (const name of names) {
    const descriptor = descriptors[name];
    if (!descriptor.enumerable || descriptor.get || descriptor.set) {
      fail('objects with non-enumerable or accessor properties are not supported');
    }
  }

  // Keys are NFC-normalized before sorting so that NFC-equal objects always
  // produce identical bytes regardless of the original key encoding. Two
  // distinct original keys that collide after NFC normalization would emit
  // duplicate JSON keys, so that is an error.
  const normalizedNames = new Set();
  const entries = names
    .map(name => {
      const normalized = name.normalize('NFC');
      if (normalizedNames.has(normalized)) {
        fail('object keys collide after NFC normalization');
      }
      normalizedNames.add(normalized);
      return [normalized, descriptors[name].value];
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([normalized, propertyValue]) =>
      `${JSON.stringify(normalized)}:${serializeValue(propertyValue, seen)}`);

  return `{${entries.join(',')}}`;
}

function serializeValue(value, seen) {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return serializeString(value);
    case 'number':
      return serializeNumber(value);
    case 'undefined':
      fail('undefined is not supported');
      break;
    case 'bigint':
      fail('bigint is not supported');
      break;
    case 'symbol':
      fail('symbol is not supported');
      break;
    case 'function':
      fail('function is not supported');
      break;
    case 'object':
      if (seen.has(value)) {
        fail('circular references are not supported');
      }
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          return serializeArray(value, seen);
        }
        return serializeObject(value, seen);
      } finally {
        seen.delete(value);
      }
    default:
      fail(`unsupported type: ${typeof value}`);
  }
}

function canonicalize(value) {
  return serializeValue(value, new WeakSet());
}

module.exports = {
  canonicalize
};
