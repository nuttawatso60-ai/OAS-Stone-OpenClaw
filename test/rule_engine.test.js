const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadRuleBundle } = require('../scripts/lib/extraction/rule_loader');
const {
  REGEX_MAX_TEXT_LENGTH,
  evaluateRule,
  evaluateBundle
} = require('../scripts/lib/extraction/rule_engine');

function makeTempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rule-engine-')));
}

function makeRule(ruleId, kind, match, overrides = {}) {
  return {
    rule_id: ruleId,
    rule_version: 1,
    kind,
    enabled: true,
    match,
    emit: { synthetic: true },
    ...overrides
  };
}

function makeBundle(rules) {
  return {
    schema_version: '1.0',
    dataset: 'intents',
    rules
  };
}

function writeBundle(directory, fileName, content) {
  const filePath = path.join(directory, fileName);
  const raw = typeof content === 'string'
    ? content
    : `${JSON.stringify(content, null, 2)}\n`;
  fs.writeFileSync(filePath, raw, 'utf8');
  return filePath;
}

function makeConversation(messages) {
  return {
    id: 'synthetic_conversation',
    messages
  };
}

function message(index, speaker, text) {
  return { index, speaker, text };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

test('loadRuleBundle loads a valid sorted bundle and returns its hash', () => {
  const directory = makeTempDir();
  const bundle = makeBundle([
    makeRule('a_disabled', 'exact_phrase', { phrase: 'unused' }, { enabled: false }),
    makeRule('b_price', 'keyword_any', { keywords: ['ราคา', 'price'] })
  ]);
  const loaded = loadRuleBundle(writeBundle(directory, 'rules.json', bundle));

  assert.equal(loaded.schema_version, '1.0');
  assert.equal(loaded.dataset, 'intents');
  assert.deepEqual(loaded.rules, bundle.rules);
  assert.match(loaded.bundle_sha256, /^[a-f0-9]{64}$/);
});

test('loadRuleBundle hash is stable across whitespace and CRLF changes', () => {
  const directory = makeTempDir();
  const bundle = makeBundle([
    makeRule('a_price', 'exact_phrase', { phrase: 'ราคา' })
  ]);
  const compactPath = writeBundle(directory, 'compact.json', JSON.stringify(bundle));
  const prettyCrlf = `${JSON.stringify(bundle, null, 4).replace(/\n/g, '\r\n')}\r\n`;
  const prettyPath = writeBundle(directory, 'pretty.json', prettyCrlf);

  assert.equal(
    loadRuleBundle(compactPath).bundle_sha256,
    loadRuleBundle(prettyPath).bundle_sha256
  );
});

test('loadRuleBundle rejects duplicate rule IDs', () => {
  const directory = makeTempDir();
  const bundle = makeBundle([
    makeRule('duplicate_rule', 'exact_phrase', { phrase: 'one' }),
    makeRule('duplicate_rule', 'exact_phrase', { phrase: 'two' })
  ]);

  assert.throws(
    () => loadRuleBundle(writeBundle(directory, 'duplicate.json', bundle)),
    /duplicate rule_id/
  );
});

test('loadRuleBundle rejects rules not strictly sorted by rule ID', () => {
  const directory = makeTempDir();
  const bundle = makeBundle([
    makeRule('z_rule', 'exact_phrase', { phrase: 'last' }),
    makeRule('a_rule', 'exact_phrase', { phrase: 'first' })
  ]);

  assert.throws(
    () => loadRuleBundle(writeBundle(directory, 'unsorted.json', bundle)),
    /strictly sorted/
  );
});

test('loadRuleBundle accepts disabled rules without removing them', () => {
  const directory = makeTempDir();
  const bundle = makeBundle([
    makeRule('disabled_rule', 'exact_phrase', { phrase: 'synthetic' }, { enabled: false })
  ]);
  const loaded = loadRuleBundle(writeBundle(directory, 'disabled.json', bundle));

  assert.equal(loaded.rules.length, 1);
  assert.equal(loaded.rules[0].enabled, false);
});

test('loadRuleBundle rejects schema-invalid documents without payload values', () => {
  const directory = makeTempDir();
  const bundle = makeBundle([
    makeRule('invalid_rule', 'unsupported_kind', { secret_text: 'do-not-report' })
  ]);

  assert.throws(
    () => loadRuleBundle(writeBundle(directory, 'invalid-schema.json', bundle)),
    error => {
      assert.match(error.message, /schema validation failed/);
      assert.doesNotMatch(error.message, /do-not-report/);
      return true;
    }
  );
});

test('loadRuleBundle reports missing files and invalid JSON clearly', () => {
  const directory = makeTempDir();
  const missingPath = path.join(directory, 'missing.json');
  const invalidPath = writeBundle(directory, 'invalid.json', '{"schema_version":');

  assert.throws(() => loadRuleBundle(missingPath), /file cannot be read \(ENOENT\)/);
  assert.throws(() => loadRuleBundle(invalidPath), /file is not valid JSON/);
});

test('loadRuleBundle never echoes raw bundle bytes in JSON parse errors', () => {
  const directory = makeTempDir();
  // V8's own JSON.parse message embeds a window of the source text, e.g.
  // `Unexpected token 'U', ..."line_id": U8f3a9cust"... is not valid JSON`.
  // Forwarding it would put bundle contents into logs.
  const malformed = {
    'secret-adjacent-to-error.json':
      '{"schema_version":"1.0","customer_phone":"+66812345678","dataset":,"rules":[]}',
    'unquoted-value.json': '{"line_id": U8f3a9customer_secret}',
    'truncated.json': '{"rules":[{"emit":{"api_key":"SUPER_SECRET_TOKEN"}}'
  };

  for (const [fileName, raw] of Object.entries(malformed)) {
    assert.throws(
      () => loadRuleBundle(writeBundle(directory, fileName, raw)),
      error => {
        assert.match(error.message, /file is not valid JSON/);
        assert.doesNotMatch(error.message, /SUPER_SECRET_TOKEN/);
        assert.doesNotMatch(error.message, /customer_secret/);
        assert.doesNotMatch(error.message, /66812345678/);
        assert.doesNotMatch(error.message, /api_key|line_id|customer_phone/);
        return true;
      }
    );
  }
});

test('loadRuleBundle rejects numbers canonical JSON cannot hash', () => {
  const directory = makeTempDir();
  // The bundle schema admits any JSON number under emit, but canonical JSON is
  // integer-only. Without an explicit check this surfaces as an opaque
  // TypeError from deep inside hashing.
  const float = makeBundle([
    makeRule('a_rule', 'exact_phrase', { phrase: 'x' }, { emit: { confidence: 0.9 } })
  ]);
  const nested = makeBundle([
    makeRule('a_rule', 'exact_phrase', { phrase: 'x' }, { emit: { a: [1, { b: 2.5 }] } })
  ]);
  const unsafe = makeBundle([
    makeRule('a_rule', 'exact_phrase', { phrase: 'x' }, { emit: { n: 1e21 } })
  ]);

  assert.throws(
    () => loadRuleBundle(writeBundle(directory, 'float.json', float)),
    /number at \/rules\/0\/emit\/confidence must be an integer/
  );
  assert.throws(
    () => loadRuleBundle(writeBundle(directory, 'nested.json', nested)),
    /number at \/rules\/0\/emit\/a\/1\/b must be an integer/
  );
  assert.throws(
    () => loadRuleBundle(writeBundle(directory, 'unsafe.json', unsafe)),
    /outside the safe integer range/
  );

  // JSON.parse maps 1.0 to the integer 1, so integer-valued literals are fine.
  const integral = makeBundle([
    makeRule('a_rule', 'exact_phrase', { phrase: 'x' }, { emit: { n: 1.0 } })
  ]);
  assert.match(
    loadRuleBundle(writeBundle(directory, 'integral.json', integral)).bundle_sha256,
    /^[a-f0-9]{64}$/
  );
});

test('loadRuleBundle validates disabled rules instead of deferring to evaluation', () => {
  const directory = makeTempDir();
  // A disabled rule is still hashed into the bundle, so an unsafe or malformed
  // match must fail at load rather than when someone flips enabled to true.
  const disabledUnsafe = makeBundle([
    makeRule('a_rule', 'regex_anchored', { pattern: '.*' }, { enabled: false })
  ]);
  const disabledEmpty = makeBundle([
    makeRule('a_rule', 'exact_phrase', {}, { enabled: false })
  ]);
  const undocumentedField = makeBundle([
    makeRule('a_rule', 'exact_phrase', { phrase: 'p', window: 3 })
  ]);

  assert.throws(
    () => loadRuleBundle(writeBundle(directory, 'disabled-unsafe.json', disabledUnsafe)),
    /Rule "a_rule" has an invalid match: .*anchored/
  );
  assert.throws(
    () => loadRuleBundle(writeBundle(directory, 'disabled-empty.json', disabledEmpty)),
    /Rule "a_rule" has an invalid match/
  );
  // The bundle schema accepts any object under match; the engine's closed
  // per-kind field set is what stops an undocumented mini-language forming.
  assert.throws(
    () => loadRuleBundle(writeBundle(directory, 'undocumented.json', undocumentedField)),
    /unsupported field "window"/
  );

  const valid = makeBundle([
    makeRule('a_rule', 'exact_phrase', { phrase: 'p' }, { enabled: false })
  ]);
  assert.equal(
    loadRuleBundle(writeBundle(directory, 'valid-disabled.json', valid)).rules[0].enabled,
    false
  );
});

test('loadRuleBundle does not mutate source bytes or retain mutable source state', () => {
  const directory = makeTempDir();
  const bundle = makeBundle([
    makeRule('unicode_rule', 'exact_phrase', { phrase: 'e\u0301' })
  ]);
  const filePath = writeBundle(directory, 'immutable.json', bundle);
  const before = fs.readFileSync(filePath, 'utf8');
  const loaded = loadRuleBundle(filePath);

  assert.equal(fs.readFileSync(filePath, 'utf8'), before);
  assert.equal(loaded.rules[0].match.phrase, 'é');

  loaded.rules[0].match.phrase = 'changed';
  assert.equal(loadRuleBundle(filePath).rules[0].match.phrase, 'é');
});

test('exact_phrase matches Thai and English substrings', () => {
  const thaiRule = makeRule('thai_phrase', 'exact_phrase', { phrase: 'ราคาเท่าไร' });
  const englishRule = makeRule('english_phrase', 'exact_phrase', { phrase: 'how much' });
  const conversation = makeConversation([
    message(0, 'customer', 'ป้ายนี้ราคาเท่าไรครับ'),
    message(1, 'customer', 'how much is this sign?')
  ]);

  assert.deepEqual(evaluateRule(thaiRule, conversation), [
    { message_indexes: [0], captures: { phrase: 'ราคาเท่าไร' } }
  ]);
  assert.deepEqual(evaluateRule(englishRule, conversation), [
    { message_indexes: [1], captures: { phrase: 'how much' } }
  ]);
});

test('exact_phrase treats NFC-equivalent text as equal', () => {
  const rule = makeRule('unicode_phrase', 'exact_phrase', { phrase: 'café' });
  const conversation = makeConversation([
    message(0, 'customer', 'show me cafe\u0301 options')
  ]);

  assert.deepEqual(evaluateRule(rule, conversation), [
    { message_indexes: [0], captures: { phrase: 'café' } }
  ]);
});

test('exact_phrase applies speaker filtering and returns no false matches', () => {
  const rule = makeRule('customer_only', 'exact_phrase', {
    phrase: 'price',
    speaker: 'customer'
  });
  const conversation = makeConversation([
    message(0, 'agent', 'price is 1000'),
    message(1, 'customer', 'thank you')
  ]);

  assert.deepEqual(evaluateRule(rule, conversation), []);
});

test('closing and adjacent_to constraints use numeric message order', () => {
  const rule = makeRule('closing_reply', 'exact_phrase', {
    phrase: 'ตกลง',
    speaker: 'customer',
    position: 'closing',
    adjacent_to: {
      speaker: 'agent',
      direction: 'previous'
    }
  });
  const conversation = makeConversation([
    message(20, 'customer', 'ตกลงครับ'),
    message(10, 'agent', 'ยืนยันราคา 1500 บาท')
  ]);

  assert.deepEqual(evaluateRule(rule, conversation), [
    { message_indexes: [10, 20], captures: { phrase: 'ตกลง' } }
  ]);
});

test('keyword_any returns all matched keywords in stable code-unit order', () => {
  const rule = makeRule('keyword_any_rule', 'keyword_any', {
    keywords: ['ราคา', 'delivery', 'price']
  });
  const conversation = makeConversation([
    message(0, 'customer', 'delivery price and ราคา')
  ]);

  assert.deepEqual(evaluateRule(rule, conversation), [
    {
      message_indexes: [0],
      captures: { matched_keywords: ['delivery', 'price', 'ราคา'] }
    }
  ]);
});

test('keyword_all requires every keyword and supports Thai substrings', () => {
  const rule = makeRule('keyword_all_rule', 'keyword_all', {
    keywords: ['หิน', 'ราคา']
  });
  const matching = makeConversation([
    message(0, 'customer', 'ขอราคาป้ายหินแกรนิต')
  ]);
  const missing = makeConversation([
    message(0, 'customer', 'ขอราคาป้าย')
  ]);

  assert.equal(evaluateRule(rule, matching).length, 1);
  assert.deepEqual(evaluateRule(rule, missing), []);
});

test('keyword rules apply speaker filtering', () => {
  const rule = makeRule('agent_keywords', 'keyword_any', {
    keywords: ['quotation'],
    speaker: 'agent'
  });
  const conversation = makeConversation([
    message(0, 'customer', 'quotation please'),
    message(1, 'agent', 'quotation attached')
  ]);

  assert.deepEqual(evaluateRule(rule, conversation), [
    {
      message_indexes: [1],
      captures: { matched_keywords: ['quotation'] }
    }
  ]);
});

test('regex_anchored accepts safe anchored patterns and deterministic flags', () => {
  const rule = makeRule('safe_regex', 'regex_anchored', {
    pattern: '^(ราคา|price)[ ]?\\d{1,3}$',
    flags: 'ui'
  });
  const conversation = makeConversation([
    message(0, 'customer', 'PRICE 123'),
    message(1, 'customer', 'ราคา 45')
  ]);

  assert.deepEqual(evaluateRule(rule, conversation), [
    {
      message_indexes: [0],
      captures: { match: 'PRICE 123', groups: ['PRICE'] }
    },
    {
      message_indexes: [1],
      captures: { match: 'ราคา 45', groups: ['ราคา'] }
    }
  ]);
});

test('regex_anchored rejects missing anchors, lookbehind, and backreferences', () => {
  const conversation = makeConversation([message(0, 'customer', 'synthetic')]);
  const invalidPatterns = [
    ['missing_anchors', 'synthetic', /anchored/],
    ['lookbehind', '^(?<=syn)thetic$', /unsupported group feature/],
    ['backreference', '^(synthetic)\\1$', /backreferences/]
  ];

  for (const [ruleId, pattern, expected] of invalidPatterns) {
    const rule = makeRule(ruleId, 'regex_anchored', { pattern });
    assert.throws(() => evaluateRule(rule, conversation), expected);
  }
});

test('regex_anchored rejects unbounded and unsafe bounded constructs', () => {
  const conversation = makeConversation([message(0, 'customer', 'aaaa')]);
  const invalidPatterns = [
    '^a+$',
    '^a*$',
    '^a{1,}$',
    '^(a|aa){1,10}$',
    '^a{1,101}$'
  ];

  for (const pattern of invalidPatterns) {
    const rule = makeRule('dangerous_regex', 'regex_anchored', { pattern });
    assert.throws(() => evaluateRule(rule, conversation), /quantifier/);
  }
});

test('regex_anchored rejects patterns exceeding the backtracking budget', () => {
  const conversation = makeConversation([message(0, 'customer', 'aaaa')]);
  // Each of these passes the anchor, wildcard, unbounded-quantifier and
  // quantified-group checks. Adjacent bounded quantifiers over the same atom
  // still multiply into exponential backtracking: before the budget existed,
  // the 42-character '^a{0,100}'.repeat(5) pattern took ~48s on a 201-char
  // message. Group wrapping must not launder the cost either.
  const budgetBusters = [
    '^a{0,100}a{0,100}$',
    `^${'a{0,100}'.repeat(5)}$`,
    `^${'a{0,100}'.repeat(31)}$`,
    `^${'a?'.repeat(60)}a{60}$`,
    `^${'[0-9]?'.repeat(40)}$`,
    `^${'(?:a{0,100})'.repeat(5)}$`
  ];

  for (const pattern of budgetBusters) {
    assert.ok(pattern.length <= 256, `pattern must fit the length cap: ${pattern.length}`);
    const rule = makeRule('budget_buster', 'regex_anchored', { pattern });
    assert.throws(() => evaluateRule(rule, conversation), /backtracking budget/);
  }
});

test('regex_anchored still accepts realistic patterns within the budget', () => {
  const conversation = makeConversation([message(0, 'customer', 'ราคา 123')]);
  const allowed = [
    '^(ราคา|price)[ ]?\\d{1,3}$',
    '^(a|b|c|d|e|f|g|h|i|j|k)$',
    '^a{0,100}$',
    '^a{0,99}a{0,9}$',
    `^${'a{100}'.repeat(41)}$`
  ];

  for (const pattern of allowed) {
    const rule = makeRule('within_budget', 'regex_anchored', { pattern });
    assert.doesNotThrow(() => evaluateRule(rule, conversation), `rejected: ${pattern}`);
  }

  // The whole point of the budget is bounded work, not just bounded syntax.
  const worstCase = makeRule('worst_case', 'regex_anchored', { pattern: '^a{0,99}a{0,9}$' });
  const atCap = makeConversation([
    message(0, 'customer', 'a'.repeat(REGEX_MAX_TEXT_LENGTH))
  ]);
  const started = process.hrtime.bigint();
  assert.deepEqual(evaluateRule(worstCase, atCap), []);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 1000, `worst legal pattern took ${elapsedMs}ms`);
});

test('regex_anchored anchors to the whole message, not to line boundaries', () => {
  // JavaScript's $ without the m flag already means \z, so no \z emulation is
  // needed. Flags are restricted to i/u, which keeps it that way.
  const rule = makeRule('whole_message', 'regex_anchored', { pattern: '^abc$' });
  const nonMatching = ['abc\ndef', 'abc\n', 'abc\r\n', 'abc\r', '\nabc'];

  for (const text of nonMatching) {
    assert.deepEqual(
      evaluateRule(rule, makeConversation([message(0, 'customer', text)])),
      [],
      `expected no match for ${JSON.stringify(text)}`
    );
  }

  assert.equal(
    evaluateRule(rule, makeConversation([message(0, 'customer', 'abc')])).length,
    1
  );
});

test('regex_anchored applies the length cap to NFC text at an exact boundary', () => {
  const rule = makeRule('cap_edge', 'regex_anchored', { pattern: '^a{0,99}a{0,9}$' });
  const evaluated = evaluateRule(
    rule,
    makeConversation([message(0, 'customer', 'a'.repeat(REGEX_MAX_TEXT_LENGTH))])
  );
  const skipped = evaluateRule(
    rule,
    makeConversation([message(0, 'customer', 'a'.repeat(REGEX_MAX_TEXT_LENGTH + 1))])
  );

  // Both are non-matches, but the cap must be an all-or-nothing skip rather
  // than a truncation that could match a prefix.
  assert.deepEqual(evaluated, []);
  assert.deepEqual(skipped, []);

  // The cap counts UTF-16 code units of the NFC-normalized text, so a decomposed
  // source string is measured after composition, not before.
  const decomposed = 'é'.repeat(REGEX_MAX_TEXT_LENGTH / 2);
  assert.equal(decomposed.length, REGEX_MAX_TEXT_LENGTH);
  assert.equal(decomposed.normalize('NFC').length, REGEX_MAX_TEXT_LENGTH / 2);
  assert.deepEqual(
    evaluateRule(
      makeRule('nfc_cap', 'regex_anchored', { pattern: '^é{0,100}$' }),
      makeConversation([message(0, 'customer', decomposed)])
    ),
    []
  );
});

test('regex_anchored skips text exceeding the documented safety cap', () => {
  const repetitions = Math.floor(REGEX_MAX_TEXT_LENGTH / 100) + 2;
  const pattern = `^${'a{100}'.repeat(repetitions)}$`;
  const text = 'a'.repeat(repetitions * 100);
  assert.ok(pattern.length <= 256);
  assert.ok(text.length > REGEX_MAX_TEXT_LENGTH);

  const rule = makeRule('length_cap', 'regex_anchored', { pattern });
  const conversation = makeConversation([message(0, 'customer', text)]);

  assert.deepEqual(evaluateRule(rule, conversation), []);
});

test('numeric_pattern matches Thai baht and preserves exact capture text', () => {
  const rule = makeRule('thai_baht', 'numeric_pattern', {
    number_pattern: 'grouped',
    units: ['บาท', 'THB']
  });
  const conversation = makeConversation([
    message(0, 'agent', 'ราคารวม 1,500 บาท ครับ')
  ]);

  assert.deepEqual(evaluateRule(rule, conversation), [
    {
      message_indexes: [0],
      captures: {
        literal: '1,500 บาท',
        number: '1,500',
        unit: 'บาท'
      }
    }
  ]);
});

test('numeric_pattern matches configured dimensions in occurrence order', () => {
  const rule = makeRule('dimensions', 'numeric_pattern', {
    number_pattern: 'decimal',
    units: ['mm', 'cm']
  });
  const conversation = makeConversation([
    message(0, 'customer', 'ขนาด 25 cm x 30.5 mm')
  ]);

  assert.deepEqual(evaluateRule(rule, conversation), [
    {
      message_indexes: [0],
      captures: { literal: '25 cm', number: '25', unit: 'cm' }
    },
    {
      message_indexes: [0],
      captures: { literal: '30.5 mm', number: '30.5', unit: 'mm' }
    }
  ]);
});

test('numeric_pattern rejects numbers without an allowed unit', () => {
  const rule = makeRule('baht_only', 'numeric_pattern', {
    number_pattern: 'integer',
    units: ['บาท']
  });
  const conversation = makeConversation([
    message(0, 'agent', 'ราคา 1500 USD และ 20 cm')
  ]);

  assert.deepEqual(evaluateRule(rule, conversation), []);
});

test('numeric_pattern never captures a fragment of a longer numeric literal', () => {
  // Capturing a fragment emits a wrong value rather than no value: "12.34 บาท"
  // under the integer pattern used to yield 34, and "1,000 บาท" yielded 000.
  const fragments = [
    ['integer', 'ราคา 1,000 บาท'],
    ['integer', 'ราคา 12.34 บาท'],
    ['integer', 'ราคา .50 บาท'],
    ['decimal', 'ราคา 1,000.50 บาท']
  ];

  for (const [numberPattern, text] of fragments) {
    const rule = makeRule('fragment_guard', 'numeric_pattern', {
      number_pattern: numberPattern,
      units: ['บาท']
    });
    assert.deepEqual(
      evaluateRule(rule, makeConversation([message(0, 'agent', text)])),
      [],
      `expected no capture for ${text} under ${numberPattern}`
    );
  }

  // The matching pattern still captures the whole literal.
  const grouped = makeRule('grouped_ok', 'numeric_pattern', {
    number_pattern: 'grouped',
    units: ['บาท']
  });
  assert.deepEqual(
    evaluateRule(grouped, makeConversation([message(0, 'agent', 'ราคา 1,000.50 บาท')]))[0].captures,
    { literal: '1,000.50 บาท', number: '1,000.50', unit: 'บาท' }
  );

  // "-" stays a token separator so ranges still work; numbers are unsigned.
  const integer = makeRule('range_ok', 'numeric_pattern', {
    number_pattern: 'integer',
    units: ['บาท']
  });
  assert.deepEqual(
    evaluateRule(integer, makeConversation([message(0, 'agent', '100-200 บาท')]))
      .map(entry => entry.captures.number),
    ['200']
  );
});

test('numeric_pattern rejects signed and embedded numeric fragments', () => {
  const integer = makeRule('integer_boundaries', 'numeric_pattern', {
    number_pattern: 'integer',
    units: ['บาท']
  });
  const decimal = makeRule('decimal_boundaries', 'numeric_pattern', {
    number_pattern: 'decimal',
    units: ['บาท']
  });

  for (const [rule, text] of [
    [integer, '-100 บาท'],
    [decimal, '-100.50 บาท'],
    [integer, 'ราคา −100 บาท'],
    [integer, 'abc100 บาท'],
    [integer, 'ref_100 บาท']
  ]) {
    assert.deepEqual(
      evaluateRule(rule, makeConversation([message(0, 'agent', text)])),
      [],
      `expected no capture for ${text}`
    );
  }

  // Leading/trailing punctuation and Thai text around a valid number remain
  // valid, and multiple occurrences preserve source order.
  assert.deepEqual(
    evaluateRule(
      integer,
      makeConversation([message(0, 'agent', '(ราคา 100 บาท และ 200 บาท),')])
    ).map(entry => entry.captures.number),
    ['100', '200']
  );
});

test('numeric_pattern matches NFC-equivalent units like other rule kinds', () => {
  const rule = makeRule('nfc_numeric_unit', 'numeric_pattern', {
    number_pattern: 'integer',
    units: ['mètre']
  });
  const sourceText = '100 me\u0300tre';

  assert.deepEqual(
    evaluateRule(rule, makeConversation([message(0, 'agent', sourceText)])),
    [{
      message_indexes: [0],
      captures: { literal: '100 mètre', number: '100', unit: 'mètre' }
    }]
  );
  assert.deepEqual(
    evaluateRule(
      makeRule('nfc_exact_unit', 'exact_phrase', { phrase: 'mètre' }),
      makeConversation([message(0, 'agent', sourceText)])
    ),
    [{ message_indexes: [0], captures: { phrase: 'mètre' } }]
  );
});

test('numeric_pattern treats configured units as literal data, not regex syntax', () => {
  const conversation = makeConversation([
    message(0, 'agent', 'ราคา 100 XX และ 200 .* และ 300 a|b')
  ]);
  const rule = makeRule('literal_units', 'numeric_pattern', {
    number_pattern: 'integer',
    units: ['.*', 'a|b', '(x)\\1']
  });

  // A unit used as regex syntax would let ".*" match "XX"; as literal data it
  // only matches the two-character sequence ".*".
  assert.deepEqual(
    evaluateRule(rule, conversation).map(entry => entry.captures.unit),
    ['.*', 'a|b']
  );
});

test('numeric_pattern prefers the longest configured unit deterministically', () => {
  const rule = makeRule('overlapping_units', 'numeric_pattern', {
    number_pattern: 'integer',
    units: ['บาท', 'บาท/ตร.ม.']
  });

  assert.deepEqual(
    evaluateRule(rule, makeConversation([message(0, 'agent', '500 บาท/ตร.ม.')]))[0].captures,
    { literal: '500 บาท/ตร.ม.', number: '500', unit: 'บาท/ตร.ม.' }
  );
});

test('conversation message indexes are rejected rather than sorted around', () => {
  const rule = makeRule('index_guard', 'exact_phrase', { phrase: 'x' });
  const invalid = [
    [[message(1, 'customer', 'x'), message(1, 'customer', 'y')], /indexes must be unique/],
    [[message(-1, 'customer', 'x')], /must be non-negative/],
    [[message(1.5, 'customer', 'x')], /must be non-negative/],
    [[{ speaker: 'customer', text: 'x' }], /must be non-negative/],
    [[{ index: '1', speaker: 'customer', text: 'x' }], /must be non-negative/],
    [[{ index: 0, text: 'x' }], /speaker must be a string/]
  ];

  for (const [messages, expected] of invalid) {
    assert.throws(() => evaluateRule(rule, makeConversation(messages)), expected);
  }

  // Duplicate indexes are rejected outright, so evaluation order never depends
  // on sort stability for equal keys.
  assert.deepEqual(evaluateRule(rule, makeConversation([])), []);
});

test('exact_phrase yields one match per message regardless of repetition', () => {
  const rule = makeRule('repeat_phrase', 'exact_phrase', { phrase: 'ab' });
  const conversation = makeConversation([message(0, 'customer', 'ab ab ab')]);

  // exact_phrase is a membership test, not an occurrence scan. numeric_pattern
  // is the only kind that emits one match per occurrence.
  assert.deepEqual(evaluateRule(rule, conversation), [
    { message_indexes: [0], captures: { phrase: 'ab' } }
  ]);

  const numeric = makeRule('repeat_numeric', 'numeric_pattern', {
    number_pattern: 'integer',
    units: ['บาท']
  });
  assert.equal(
    evaluateRule(numeric, makeConversation([message(0, 'agent', '100 บาท 100 บาท')])).length,
    2
  );
});

test('adjacent_to means array-neighbour after sorting, not index plus or minus one', () => {
  const rule = makeRule('gap_adjacent', 'exact_phrase', {
    phrase: 'x',
    adjacent_to: { speaker: 'agent' }
  });
  // Indexes 1 and 9 are neighbours because nothing sits between them once the
  // messages are ordered. Gaps in the index sequence do not break adjacency.
  const withGap = makeConversation([message(9, 'customer', 'x'), message(1, 'agent', 'q')]);
  const shuffled = makeConversation([message(1, 'agent', 'q'), message(9, 'customer', 'x')]);

  assert.deepEqual(evaluateRule(rule, withGap), [
    { message_indexes: [1, 9], captures: { phrase: 'x' } }
  ]);
  assert.deepEqual(evaluateRule(rule, shuffled), evaluateRule(rule, withGap));

  // direction "either" with a qualifying neighbour on both sides emits one
  // match per neighbour, each carrying its own message_indexes pair.
  const bothSides = makeConversation([
    message(0, 'agent', 'q'),
    message(1, 'customer', 'x'),
    message(2, 'agent', 'q')
  ]);
  assert.deepEqual(
    evaluateRule(rule, bothSides).map(entry => entry.message_indexes),
    [[0, 1], [1, 2]]
  );

  // Edges yield nothing rather than wrapping around.
  const first = makeRule('needs_previous', 'exact_phrase', {
    phrase: 'x',
    adjacent_to: { speaker: 'agent', direction: 'previous' }
  });
  assert.deepEqual(
    evaluateRule(first, makeConversation([message(0, 'customer', 'x'), message(1, 'agent', 'q')])),
    []
  );

  // adjacent_to has a closed field set; it is not an extension point.
  for (const [constraint, expected] of [
    [{ direction: 'next' }, /adjacent_to.speaker must be a string/],
    [{ speaker: 'a', window: 3 }, /unsupported field "window"/],
    [{ speaker: 'a', direction: 'both' }, /previous, next, or either/],
    [{ speaker: ['a', 'b'] }, /adjacent_to.speaker must be a string/]
  ]) {
    const invalid = makeRule('bad_adjacent', 'exact_phrase', {
      phrase: 'x',
      adjacent_to: constraint
    });
    assert.throws(
      () => evaluateRule(invalid, makeConversation([message(0, 'customer', 'x')])),
      expected
    );
  }
});

test('closing position follows numeric order and never infers speakers', () => {
  const closing = makeRule('closing_rule', 'exact_phrase', {
    phrase: 'x',
    position: 'closing'
  });

  assert.deepEqual(evaluateRule(closing, makeConversation([])), []);
  assert.deepEqual(
    evaluateRule(closing, makeConversation([message(9, 'customer', 'x'), message(1, 'customer', 'x')]))
      .map(entry => entry.message_indexes),
    [[9]]
  );

  // Speaker matching is exact: no case folding and no inference.
  const speakerRule = makeRule('speaker_exact', 'exact_phrase', {
    phrase: 'x',
    speaker: 'Customer'
  });
  assert.deepEqual(
    evaluateRule(speakerRule, makeConversation([message(0, 'customer', 'x')])),
    []
  );
  assert.throws(
    () => evaluateRule(
      makeRule('speaker_type', 'exact_phrase', { phrase: 'x', speaker: ['a', 'b'] }),
      makeConversation([message(0, 'customer', 'x')])
    ),
    /speaker must be a string/
  );
});

test('an invalid match is rejected even when the rule is disabled', () => {
  // Otherwise an unsafe pattern sits dormant in a hashed bundle and only fails
  // when someone flips enabled to true.
  const rule = makeRule('parked_rule', 'regex_anchored', { pattern: '.*' }, { enabled: false });
  assert.throws(
    () => evaluateRule(rule, makeConversation([message(0, 'customer', 'x')])),
    /anchored/
  );
  assert.throws(
    () => evaluateBundle([rule], makeConversation([message(0, 'customer', 'x')])),
    /anchored/
  );
});

test('evaluateBundle preserves enabled rule order and includes zero matches', () => {
  const rules = [
    makeRule('first_rule', 'exact_phrase', { phrase: 'present' }),
    makeRule('disabled_rule', 'exact_phrase', { phrase: 'present' }, { enabled: false }),
    makeRule('zero_match_rule', 'exact_phrase', { phrase: 'absent' })
  ];
  const conversation = makeConversation([
    message(0, 'customer', 'present')
  ]);
  const result = evaluateBundle(rules, conversation);

  assert.deepEqual(result.map(entry => entry.rule.rule_id), [
    'first_rule',
    'zero_match_rule'
  ]);
  assert.equal(result[0].matches.length, 1);
  assert.deepEqual(result[1].matches, []);
});

test('evaluation is byte-stable across repeated runs and input ordering', () => {
  const firstRule = makeRule('stable_keywords', 'keyword_any', {
    keywords: ['ราคา', 'delivery', 'price']
  });
  const reorderedRule = makeRule('stable_keywords', 'keyword_any', {
    keywords: ['price', 'ราคา', 'delivery']
  });
  const firstConversation = makeConversation([
    message(5, 'customer', 'ราคา and delivery'),
    message(1, 'customer', 'price')
  ]);
  const reorderedConversation = makeConversation([
    message(1, 'customer', 'price'),
    message(5, 'customer', 'ราคา and delivery')
  ]);

  const first = evaluateRule(firstRule, firstConversation);
  assert.deepEqual(evaluateRule(firstRule, firstConversation), first);
  assert.deepEqual(evaluateRule(reorderedRule, reorderedConversation), first);
  assert.equal(
    JSON.stringify(evaluateRule(reorderedRule, reorderedConversation)),
    JSON.stringify(first)
  );
});

test('evaluation does not mutate rule or conversation inputs', () => {
  const rule = makeRule('immutable_rule', 'keyword_all', {
    keywords: ['price', 'delivery']
  });
  const conversation = makeConversation([
    message(2, 'customer', 'delivery and price'),
    message(1, 'agent', 'synthetic')
  ]);
  const ruleSnapshot = structuredClone(rule);
  const conversationSnapshot = structuredClone(conversation);

  deepFreeze(rule);
  deepFreeze(conversation);
  evaluateRule(rule, conversation);

  assert.deepEqual(rule, ruleSnapshot);
  assert.deepEqual(conversation, conversationSnapshot);
});
