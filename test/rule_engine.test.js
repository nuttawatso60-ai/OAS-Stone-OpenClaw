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

  assert.throws(() => loadRuleBundle(missingPath), /Failed to load rule bundle/);
  assert.throws(() => loadRuleBundle(invalidPath), /Failed to parse schema/);
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
