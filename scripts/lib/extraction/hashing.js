'use strict';

const crypto = require('node:crypto');
const { canonicalize } = require('./canonical_json');

function sha256Hex(input) {
  if (typeof input !== 'string' && !Buffer.isBuffer(input)) {
    throw new TypeError('sha256Hex input must be a string or Buffer');
  }
  // Strings are hashed as UTF-8 bytes; Buffers are hashed as raw bytes.
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

// Domain tags are lowercase segments separated by ":" and must end with ":".
// This makes `domainTag + canonicalJson` prefix-free: if tagA + jsonA equaled
// tagB + jsonB with tagA a proper prefix of tagB, jsonA would have to start
// with the rest of tagB, which contains ":" — but a canonical JSON document
// over this tag alphabet can only be a number, true, false, or null, none of
// which contain ":". Objects, arrays, and strings start with characters the
// tag alphabet excludes.
const DOMAIN_TAG_PATTERN = /^[a-z0-9_.-]+(:[a-z0-9_.-]+)*:$/;

function assertDomainTag(domainTag) {
  if (typeof domainTag !== 'string' || domainTag.length === 0) {
    throw new TypeError('domainTag must be a non-empty string');
  }
  if (domainTag.length > 64) {
    throw new TypeError('domainTag must be at most 64 characters');
  }
  if (!DOMAIN_TAG_PATTERN.test(domainTag)) {
    throw new TypeError(
      'domainTag must match /^[a-z0-9_.-]+(:[a-z0-9_.-]+)*:$/ (e.g. "cand:v1:")'
    );
  }
}

function hashCanonical(domainTag, value) {
  assertDomainTag(domainTag);
  return sha256Hex(domainTag + canonicalize(value));
}

function hashId(prefix, domainTag, value, length) {
  if (typeof prefix !== 'string') {
    throw new TypeError('prefix must be a string');
  }
  if (!Number.isInteger(length) || length < 8 || length > 64) {
    throw new TypeError('length must be an integer from 8 through 64');
  }
  return prefix + hashCanonical(domainTag, value).slice(0, length);
}

module.exports = {
  sha256Hex,
  hashCanonical,
  hashId
};
