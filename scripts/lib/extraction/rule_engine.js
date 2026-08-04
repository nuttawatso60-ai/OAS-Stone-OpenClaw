'use strict';

const REGEX_MAX_PATTERN_LENGTH = 256;
const REGEX_MAX_TEXT_LENGTH = 4096;
const REGEX_MAX_BOUNDED_QUANTIFIER = 100;
// Upper bound on the number of distinct ways a pattern's quantifiers and
// alternations can be assigned. Patterns are anchored at ^ so the engine has a
// single start position, which makes this product an upper bound on the paths a
// backtracking engine explores. Rejecting unbounded quantifiers and quantified
// groups is not sufficient on its own: adjacent bounded quantifiers over the
// same atom (^a{0,100}a{0,100}...$) are individually legal yet multiply into
// exponential backtracking, so the budget is enforced across the whole pattern.
const REGEX_MAX_SEARCH_BUDGET = 1000;

const RULE_KINDS = new Set([
  'exact_phrase',
  'keyword_any',
  'keyword_all',
  'regex_anchored',
  'numeric_pattern'
]);

const COMMON_MATCH_KEYS = new Set(['speaker', 'position', 'adjacent_to']);
const KIND_MATCH_KEYS = {
  exact_phrase: new Set(['phrase']),
  keyword_any: new Set(['keywords']),
  keyword_all: new Set(['keywords']),
  regex_anchored: new Set(['pattern', 'flags']),
  numeric_pattern: new Set(['number_pattern', 'units'])
};

const NUMERIC_PATTERNS = {
  integer: '[0-9]+',
  decimal: '[0-9]+(?:\\.[0-9]+)?',
  grouped: '(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]+)?'
};

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirePlainObject(value, name) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${name} must be a plain object`);
  }
}

function normalizeString(value, name, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return value.normalize('NFC');
}

function sortedUniqueStrings(values, name) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${name} must be a non-empty array`);
  }

  const normalized = values.map((value, index) =>
    normalizeString(value, `${name}[${index}]`));
  return [...new Set(normalized)].sort(compareCodeUnits);
}

function sortedUniqueLiteralStrings(values, name) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${name} must be a non-empty array`);
  }

  const strings = values.map((value, index) => {
    if (typeof value !== 'string') {
      throw new TypeError(`${name}[${index}] must be a string`);
    }
    if (value.length === 0) {
      throw new Error(`${name}[${index}] must not be empty`);
    }
    return value;
  });
  return [...new Set(strings)].sort(compareCodeUnits);
}

function validateAdjacentConstraint(adjacentTo) {
  requirePlainObject(adjacentTo, 'rule.match.adjacent_to');
  const allowed = new Set(['speaker', 'direction']);
  for (const key of Object.keys(adjacentTo)) {
    if (!allowed.has(key)) {
      throw new Error(`rule.match.adjacent_to contains unsupported field "${key}"`);
    }
  }

  const speaker = normalizeString(
    adjacentTo.speaker,
    'rule.match.adjacent_to.speaker'
  );
  const direction = adjacentTo.direction === undefined
    ? 'either'
    : adjacentTo.direction;
  if (!['previous', 'next', 'either'].includes(direction)) {
    throw new Error(
      'rule.match.adjacent_to.direction must be previous, next, or either'
    );
  }

  return { speaker, direction };
}

function validateMatch(rule) {
  requirePlainObject(rule.match, 'rule.match');
  const kindKeys = KIND_MATCH_KEYS[rule.kind];
  const allowed = new Set([...COMMON_MATCH_KEYS, ...kindKeys]);
  for (const key of Object.keys(rule.match)) {
    if (!allowed.has(key)) {
      throw new Error(`rule.match contains unsupported field "${key}" for ${rule.kind}`);
    }
  }

  const common = {};
  if (rule.match.speaker !== undefined) {
    common.speaker = normalizeString(rule.match.speaker, 'rule.match.speaker');
  }
  if (rule.match.position !== undefined) {
    if (rule.match.position !== 'closing') {
      throw new Error('rule.match.position must be "closing"');
    }
    common.position = 'closing';
  }
  if (rule.match.adjacent_to !== undefined) {
    common.adjacentTo = validateAdjacentConstraint(rule.match.adjacent_to);
  }

  switch (rule.kind) {
    case 'exact_phrase':
      return {
        ...common,
        phrase: normalizeString(rule.match.phrase, 'rule.match.phrase')
      };
    case 'keyword_any':
    case 'keyword_all':
      return {
        ...common,
        keywords: sortedUniqueStrings(rule.match.keywords, 'rule.match.keywords')
      };
    case 'regex_anchored':
      return {
        ...common,
        regex: compileSafeRegex(rule.match.pattern, rule.match.flags)
      };
    case 'numeric_pattern':
      return {
        ...common,
        numeric: compileNumericPattern(rule.match)
      };
    default:
      throw new Error(`Unsupported rule kind "${rule.kind}"`);
  }
}

function validateRule(rule) {
  requirePlainObject(rule, 'rule');
  if (typeof rule.enabled !== 'boolean') {
    throw new TypeError('rule.enabled must be a boolean');
  }
  if (!RULE_KINDS.has(rule.kind)) {
    throw new Error(`Unsupported rule kind "${rule.kind}"`);
  }
}

function normalizedMessages(conversation) {
  requirePlainObject(conversation, 'conversation');
  normalizeString(conversation.id, 'conversation.id');
  if (!Array.isArray(conversation.messages)) {
    throw new TypeError('conversation.messages must be an array');
  }

  const seenIndexes = new Set();
  const messages = conversation.messages.map((message, position) => {
    requirePlainObject(message, `conversation.messages[${position}]`);
    if (!Number.isInteger(message.index) || message.index < 0) {
      throw new Error(`conversation.messages[${position}].index must be non-negative`);
    }
    if (seenIndexes.has(message.index)) {
      throw new Error('conversation message indexes must be unique');
    }
    seenIndexes.add(message.index);

    if (typeof message.text !== 'string') {
      throw new TypeError(`conversation.messages[${position}].text must be a string`);
    }

    return {
      index: message.index,
      speaker: normalizeString(
        message.speaker,
        `conversation.messages[${position}].speaker`
      ),
      text: message.text.normalize('NFC'),
      sourceText: message.text
    };
  });

  return messages.sort((left, right) => left.index - right.index);
}

function adjacentMessages(messages, position, constraint) {
  if (!constraint) {
    return [null];
  }

  const candidates = [];
  if (constraint.direction !== 'next' && position > 0) {
    candidates.push(messages[position - 1]);
  }
  if (constraint.direction !== 'previous' && position + 1 < messages.length) {
    candidates.push(messages[position + 1]);
  }
  return candidates.filter(message => message.speaker === constraint.speaker);
}

function matchingContexts(messages, match) {
  const closingPosition = messages.length - 1;
  const contexts = [];

  for (let position = 0; position < messages.length; position += 1) {
    const message = messages[position];
    if (match.speaker !== undefined && message.speaker !== match.speaker) {
      continue;
    }
    if (match.position === 'closing' && position !== closingPosition) {
      continue;
    }

    for (const adjacent of adjacentMessages(messages, position, match.adjacentTo)) {
      const messageIndexes = adjacent === null
        ? [message.index]
        : [message.index, adjacent.index].sort((left, right) => left - right);
      contexts.push({ message, messageIndexes });
    }
  }

  return contexts;
}

function isEscaped(value, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function normalizedRegexFlags(flags) {
  if (flags === undefined) {
    return '';
  }
  if (typeof flags !== 'string') {
    throw new TypeError('rule.match.flags must be a string');
  }

  const seen = new Set();
  for (const flag of flags) {
    if (!['i', 'u'].includes(flag)) {
      throw new Error('rule.match.flags may contain only "i" and "u"');
    }
    if (seen.has(flag)) {
      throw new Error('rule.match.flags must not contain duplicates');
    }
    seen.add(flag);
  }
  return [...seen].sort(compareCodeUnits).join('');
}

function validateSafeRegexPattern(pattern) {
  const normalized = normalizeString(pattern, 'rule.match.pattern');
  if (normalized.length > REGEX_MAX_PATTERN_LENGTH) {
    throw new Error(
      `rule.match.pattern exceeds ${REGEX_MAX_PATTERN_LENGTH} characters`
    );
  }
  if (
    normalized[0] !== '^' ||
    normalized.at(-1) !== '$' ||
    isEscaped(normalized, normalized.length - 1)
  ) {
    throw new Error('rule.match.pattern must be anchored with ^ and $');
  }

  const body = normalized.slice(1, -1);
  // One frame per open group. `current` is the product of the factors seen so
  // far in the active alternation branch; `alternatives` accumulates the cost of
  // completed branches. A group's cost is alternatives + current, which is
  // multiplied into the enclosing frame when the group closes. Group boundaries
  // are therefore transparent: (?:a{0,100})(?:a{0,100}) costs the same as
  // a{0,100}a{0,100}.
  const budgetFrames = [{ alternatives: 0, current: 1 }];
  const multiplyBudget = factor => {
    const frame = budgetFrames.at(-1);
    frame.current *= factor;
    // Every factor is >= 1 and enclosing frames only ever multiply, so a frame
    // exceeding the budget can never be brought back under it.
    if (frame.current > REGEX_MAX_SEARCH_BUDGET) {
      throw new Error(
        `rule.match.pattern exceeds the backtracking budget of ${REGEX_MAX_SEARCH_BUDGET}`
      );
    }
  };

  let depth = 0;
  let inClass = false;
  let classHasContent = false;
  let previousCanQuantify = false;
  let previousWasGroup = false;
  let previousWasQuantifier = false;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];

    if (character === '\n' || character === '\r') {
      throw new Error('rule.match.pattern must not contain line breaks');
    }

    if (inClass) {
      if (character === '\\') {
        const escaped = body[index + 1];
        if (
          escaped === undefined ||
          (!'d\\^-]'.includes(escaped))
        ) {
          throw new Error('rule.match.pattern contains an unsupported escape');
        }
        index += 1;
        classHasContent = true;
        continue;
      }
      if (character === ']') {
        if (!classHasContent) {
          throw new Error('rule.match.pattern contains an empty character class');
        }
        inClass = false;
        previousCanQuantify = true;
        previousWasGroup = false;
        previousWasQuantifier = false;
        continue;
      }
      classHasContent = true;
      continue;
    }

    if (character === '\\') {
      const escaped = body[index + 1];
      if (/[1-9]/.test(escaped || '') || escaped === 'k') {
        throw new Error('rule.match.pattern must not contain backreferences');
      }
      if (
        escaped === undefined ||
        (!'d\\^$.[\\]{}()|?*+-'.includes(escaped))
      ) {
        throw new Error('rule.match.pattern contains an unsupported escape');
      }
      index += 1;
      previousCanQuantify = true;
      previousWasGroup = false;
      previousWasQuantifier = false;
      continue;
    }

    if (character === '[') {
      inClass = true;
      classHasContent = false;
      previousCanQuantify = false;
      previousWasGroup = false;
      previousWasQuantifier = false;
      continue;
    }
    if (character === ']') {
      throw new Error('rule.match.pattern contains an unmatched character class');
    }
    if (character === '^' || character === '$' || character === '.') {
      throw new Error('rule.match.pattern contains an unsupported regex operator');
    }
    if (character === '*' || character === '+') {
      throw new Error('rule.match.pattern contains an unbounded quantifier');
    }
    if (character === '(') {
      if (body[index + 1] === '?' && body.slice(index + 1, index + 3) !== '?:') {
        throw new Error('rule.match.pattern contains an unsupported group feature');
      }
      if (body.slice(index + 1, index + 3) === '?:') {
        index += 2;
      }
      depth += 1;
      budgetFrames.push({ alternatives: 0, current: 1 });
      previousCanQuantify = false;
      previousWasGroup = false;
      previousWasQuantifier = false;
      continue;
    }
    if (character === ')') {
      if (depth === 0) {
        throw new Error('rule.match.pattern contains an unmatched group');
      }
      depth -= 1;
      const closed = budgetFrames.pop();
      multiplyBudget(closed.alternatives + closed.current);
      previousCanQuantify = true;
      previousWasGroup = true;
      previousWasQuantifier = false;
      continue;
    }
    if (character === '|') {
      if (depth === 0 || !previousCanQuantify) {
        throw new Error('rule.match.pattern alternation must be inside a group');
      }
      const frame = budgetFrames.at(-1);
      frame.alternatives += frame.current;
      frame.current = 1;
      previousCanQuantify = false;
      previousWasGroup = false;
      previousWasQuantifier = false;
      continue;
    }
    if (character === '?') {
      if (!previousCanQuantify || previousWasGroup || previousWasQuantifier) {
        throw new Error('rule.match.pattern contains an unsafe optional quantifier');
      }
      multiplyBudget(2);
      previousWasQuantifier = true;
      previousCanQuantify = false;
      continue;
    }
    if (character === '{') {
      const end = body.indexOf('}', index + 1);
      if (end === -1) {
        throw new Error('rule.match.pattern contains an unterminated quantifier');
      }
      const quantifier = body.slice(index + 1, end);
      const match = /^([0-9]+)(?:,([0-9]+))?$/.exec(quantifier);
      if (
        !match ||
        !previousCanQuantify ||
        previousWasGroup ||
        previousWasQuantifier
      ) {
        throw new Error('rule.match.pattern contains an unsafe bounded quantifier');
      }
      const minimum = Number(match[1]);
      const maximum = match[2] === undefined ? minimum : Number(match[2]);
      if (
        minimum > maximum ||
        maximum > REGEX_MAX_BOUNDED_QUANTIFIER
      ) {
        throw new Error(
          `rule.match.pattern quantifiers must be bounded at ${REGEX_MAX_BOUNDED_QUANTIFIER}`
        );
      }
      multiplyBudget(maximum - minimum + 1);
      index = end;
      previousWasQuantifier = true;
      previousCanQuantify = false;
      continue;
    }
    if (character === '}') {
      throw new Error('rule.match.pattern contains an unmatched quantifier');
    }

    previousCanQuantify = true;
    previousWasGroup = false;
    previousWasQuantifier = false;
  }

  if (
    inClass ||
    depth !== 0 ||
    (!previousCanQuantify && !previousWasQuantifier)
  ) {
    throw new Error('rule.match.pattern has an incomplete regex structure');
  }

  const total = budgetFrames[0].alternatives + budgetFrames[0].current;
  if (total > REGEX_MAX_SEARCH_BUDGET) {
    throw new Error(
      `rule.match.pattern exceeds the backtracking budget of ${REGEX_MAX_SEARCH_BUDGET}`
    );
  }

  return normalized;
}

function compileSafeRegex(pattern, flags) {
  const normalizedPattern = validateSafeRegexPattern(pattern);
  const normalizedFlags = normalizedRegexFlags(flags);
  try {
    return new RegExp(normalizedPattern, normalizedFlags);
  } catch (error) {
    throw new Error(`rule.match.pattern is not a valid safe regex: ${error.message}`);
  }
}

function escapeRegexLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileNumericPattern(match) {
  if (!Object.prototype.hasOwnProperty.call(NUMERIC_PATTERNS, match.number_pattern)) {
    throw new Error(
      'rule.match.number_pattern must be integer, decimal, or grouped'
    );
  }
  const units = sortedUniqueLiteralStrings(match.units, 'rule.match.units')
    .sort((left, right) =>
      right.length - left.length || compareCodeUnits(left, right));
  const unitAlternation = units.map(escapeRegexLiteral).join('|');
  return new RegExp(
    `(${NUMERIC_PATTERNS[match.number_pattern]})[ \\t]*(${unitAlternation})`,
    'gu'
  );
}

function nextCodePoint(value, index) {
  if (index >= value.length) {
    return '';
  }
  // Slicing the remainder here would make numericMatches quadratic in text
  // length; codePointAt is O(1) and still returns a whole code point.
  return String.fromCodePoint(value.codePointAt(index));
}

// A digit, comma, or period immediately before a match means the match is a
// fragment of a longer numeric literal. Capturing it would emit a wrong value
// rather than no value: "12.34 บาท" under `integer` would yield 34, and
// "1,000 บาท" would yield 000. "-" is deliberately excluded so that ranges such
// as "100-200 บาท" still capture 200; numbers are unsigned by contract.
const NUMERIC_LEFT_BOUNDARY = /[0-9.,]/;
const NUMERIC_RIGHT_BOUNDARY = /[\p{L}\p{N}\p{M}_]/u;

function numericMatches(text, regex) {
  const matches = [];
  regex.lastIndex = 0;

  for (const match of text.matchAll(regex)) {
    const previous = match.index === 0 ? '' : text[match.index - 1];
    const end = match.index + match[0].length;
    const next = nextCodePoint(text, end);
    if (NUMERIC_LEFT_BOUNDARY.test(previous) || NUMERIC_RIGHT_BOUNDARY.test(next)) {
      continue;
    }
    matches.push({
      literal: match[0],
      number: match[1],
      unit: match[2]
    });
  }

  return matches;
}

// Validates a rule's shape and match without evaluating it. `enabled` is not
// consulted: a disabled rule is still part of the hashed bundle, so an invalid
// or unsafe match must not be able to hide behind `enabled: false` and only
// surface when someone flips the flag.
function validateRuleDefinition(rule) {
  validateRule(rule);
  validateMatch(rule);
}

function evaluateRule(rule, conversation) {
  validateRule(rule);
  const match = validateMatch(rule);
  if (!rule.enabled) {
    return [];
  }

  const messages = normalizedMessages(conversation);
  const contexts = matchingContexts(messages, match);
  const results = [];

  for (const context of contexts) {
    const { text } = context.message;

    switch (rule.kind) {
      case 'exact_phrase':
        if (text.includes(match.phrase)) {
          results.push({
            message_indexes: context.messageIndexes,
            captures: { phrase: match.phrase }
          });
        }
        break;
      case 'keyword_any': {
        const matchedKeywords = match.keywords.filter(keyword => text.includes(keyword));
        if (matchedKeywords.length > 0) {
          results.push({
            message_indexes: context.messageIndexes,
            captures: { matched_keywords: matchedKeywords }
          });
        }
        break;
      }
      case 'keyword_all':
        if (match.keywords.every(keyword => text.includes(keyword))) {
          results.push({
            message_indexes: context.messageIndexes,
            captures: { matched_keywords: [...match.keywords] }
          });
        }
        break;
      case 'regex_anchored':
        if (text.length <= REGEX_MAX_TEXT_LENGTH) {
          const regexMatch = match.regex.exec(text);
          if (regexMatch !== null) {
            results.push({
              message_indexes: context.messageIndexes,
              captures: {
                match: regexMatch[0],
                groups: regexMatch.slice(1)
              }
            });
          }
        }
        break;
      case 'numeric_pattern':
        for (const capture of numericMatches(context.message.sourceText, match.numeric)) {
          results.push({
            message_indexes: context.messageIndexes,
            captures: capture
          });
        }
        break;
      default:
        throw new Error(`Unsupported rule kind "${rule.kind}"`);
    }
  }

  return results;
}

function evaluateBundle(rules, conversation) {
  if (!Array.isArray(rules)) {
    throw new TypeError('rules must be an array');
  }

  const results = [];
  for (const rule of rules) {
    validateRuleDefinition(rule);
    if (!rule.enabled) {
      continue;
    }
    results.push({
      rule,
      matches: evaluateRule(rule, conversation)
    });
  }
  return results;
}

module.exports = {
  REGEX_MAX_TEXT_LENGTH,
  REGEX_MAX_SEARCH_BUDGET,
  validateRuleDefinition,
  evaluateRule,
  evaluateBundle
};
