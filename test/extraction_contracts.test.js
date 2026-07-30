const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  loadSchema,
  compileSchema,
  validateDocument,
  formatValidationErrors
} = require('../scripts/lib/extraction/schema_validator');

const schemaDir = path.join(__dirname, '..', 'knowledge', 'datasets', 'schemas');

function schemaPath(fileName) {
  return path.join(schemaDir, fileName);
}

function validatorFor(fileName) {
  return compileSchema(loadSchema(schemaPath(fileName)));
}

function assertValid(validate, document) {
  assert.equal(validate(document), true, formatValidationErrors(validate.errors || []));
}

function assertInvalid(validate, document) {
  assert.equal(validate(document), false);
  assert.ok(validate.errors?.length > 0);
}

function validRuleBundle() {
  return {
    schema_version: '1.0',
    dataset: 'intents',
    rules: [
      {
        rule_id: 'intent_price_question',
        rule_version: 1,
        kind: 'keyword_any',
        enabled: true,
        match: {
          keywords: ['price', 'ราคา'],
          options: { case_sensitive: false }
        },
        emit: {
          intent: 'ask_price',
          confidence_basis: 1
        }
      }
    ]
  };
}

function validCandidateFile() {
  return {
    schema_version: '1.0',
    run_id: 'run_0123456789abcdef',
    dataset: 'intents',
    candidates: [
      {
        candidate_id: 'cand_0123456789abcdef01234567',
        dataset: 'intents',
        rule_id: 'intent_price_question',
        rule_version: 1,
        source_ref: 'src_0123456789abcdef',
        message_indexes: [0, 2],
        payload: {
          id: 'ask_price',
          examples: ['synthetic example']
        }
      }
    ]
  };
}

function validRunManifest() {
  return {
    schema_version: '1.0',
    run_id: 'run_0123456789abcdef',
    identity: {
      pipeline_version: '2.0',
      extractor_version: '1.0.0',
      input_sha256: 'a'.repeat(64),
      requested_datasets: ['intents'],
      rule_bundles: {
        intents: {
          sha256: 'b'.repeat(64),
          rule_count: 1
        }
      }
    },
    info: {
      generated_at: '2026-07-30T12:00:00.000Z',
      node_version: 'v24.18.1',
      candidate_files: [
        {
          path: 'knowledge/datasets/candidates/intents.json',
          sha256: 'c'.repeat(64),
          candidate_count: 1
        }
      ]
    }
  };
}

function validReviewDecision(decision) {
  const entry = {
    candidate_id: 'cand_0123456789abcdef01234567',
    decision,
    reason: 'synthetic review reason'
  };
  if (decision === 'edit') {
    entry.final_payload = {
      id: 'ask_price',
      label_th: 'synthetic edited label'
    };
  }

  return {
    schema_version: '1.0',
    run_id: 'run_0123456789abcdef',
    reviewed_by: 'synthetic-reviewer',
    decisions: [entry]
  };
}

test('rule bundle accepts a valid deterministic rule bundle', () => {
  assertValid(validatorFor('rule_bundle.schema.json'), validRuleBundle());
});

test('rule bundle rejects invalid datasets and missing required fields', () => {
  const validate = validatorFor('rule_bundle.schema.json');
  const invalidDataset = validRuleBundle();
  invalidDataset.dataset = 'unknown';
  const missingRules = validRuleBundle();
  delete missingRules.rules;

  assertInvalid(validate, invalidDataset);
  assertInvalid(validate, missingRules);
});

test('rule bundle rejects invalid rule versions and unknown fields', () => {
  const validate = validatorFor('rule_bundle.schema.json');
  const invalidVersion = validRuleBundle();
  invalidVersion.rules[0].rule_version = 0;
  const unknownRoot = { ...validRuleBundle(), generated_at: 'not-allowed' };
  const unknownRule = validRuleBundle();
  unknownRule.rules[0].script = 'return true';

  assertInvalid(validate, invalidVersion);
  assertInvalid(validate, unknownRoot);
  assertInvalid(validate, unknownRule);
});

test('rule bundle match and emit values must be JSON data', () => {
  const validate = validatorFor('rule_bundle.schema.json');
  const executableMatch = validRuleBundle();
  executableMatch.rules[0].match.predicate = () => true;

  assertInvalid(validate, executableMatch);
});

test('candidate file accepts a valid candidate envelope', () => {
  assertValid(validatorFor('candidate_file.schema.json'), validCandidateFile());
});

test('candidate file rejects malformed run, candidate, and source IDs', () => {
  const validate = validatorFor('candidate_file.schema.json');
  const mutations = [
    document => { document.run_id = 'run_ABC'; },
    document => { document.candidates[0].candidate_id = 'cand_0123'; },
    document => { document.candidates[0].source_ref = 'source_0123456789abcdef'; }
  ];

  for (const mutate of mutations) {
    const document = validCandidateFile();
    mutate(document);
    assertInvalid(validate, document);
  }
});

test('candidate file rejects duplicate and negative message indexes', () => {
  const validate = validatorFor('candidate_file.schema.json');
  const duplicateIndexes = validCandidateFile();
  duplicateIndexes.candidates[0].message_indexes = [1, 1];
  const negativeIndex = validCandidateFile();
  negativeIndex.candidates[0].message_indexes = [-1];

  assertInvalid(validate, duplicateIndexes);
  assertInvalid(validate, negativeIndex);
});

test('candidate file rejects empty message index arrays', () => {
  const validate = validatorFor('candidate_file.schema.json');
  const document = validCandidateFile();
  document.candidates[0].message_indexes = [];

  assertInvalid(validate, document);
});

test('candidate file rejects timestamps and extra candidate fields', () => {
  const validate = validatorFor('candidate_file.schema.json');
  const rootTimestamp = {
    ...validCandidateFile(),
    generated_at: '2026-07-30T12:00:00.000Z'
  };
  const candidateTimestamp = validCandidateFile();
  candidateTimestamp.candidates[0].created_at = '2026-07-30T12:00:00.000Z';
  const rawPath = validCandidateFile();
  rawPath.candidates[0].raw_path = 'synthetic/raw.txt';

  assertInvalid(validate, rootTimestamp);
  assertInvalid(validate, candidateTimestamp);
  assertInvalid(validate, rawPath);
});

test('run manifest accepts a valid identity and informational envelope', () => {
  assertValid(validatorFor('run_manifest.schema.json'), validRunManifest());
});

test('run manifest rejects malformed SHA-256 values', () => {
  const validate = validatorFor('run_manifest.schema.json');
  const invalidInputHash = validRunManifest();
  invalidInputHash.identity.input_sha256 = 'ABC';
  const invalidBundleHash = validRunManifest();
  invalidBundleHash.identity.rule_bundles.intents.sha256 = 'b'.repeat(63);
  const invalidFileHash = validRunManifest();
  invalidFileHash.info.candidate_files[0].sha256 = 'g'.repeat(64);

  assertInvalid(validate, invalidInputHash);
  assertInvalid(validate, invalidBundleHash);
  assertInvalid(validate, invalidFileHash);
});

test('run manifest rejects duplicate requested datasets', () => {
  const validate = validatorFor('run_manifest.schema.json');
  const document = validRunManifest();
  document.identity.requested_datasets = ['intents', 'intents'];

  assertInvalid(validate, document);
});

test('run manifest rejects POSIX and Windows absolute candidate file paths', () => {
  const validate = validatorFor('run_manifest.schema.json');
  const posixAbsolute = validRunManifest();
  posixAbsolute.info.candidate_files[0].path = '/tmp/intents.json';
  const windowsAbsolute = validRunManifest();
  windowsAbsolute.info.candidate_files[0].path = 'C:\\temp\\intents.json';

  assertInvalid(validate, posixAbsolute);
  assertInvalid(validate, windowsAbsolute);
});

test('run manifest rejects UNC, traversal, drive-relative, and malformed candidate paths', () => {
  const validate = validatorFor('run_manifest.schema.json');
  const rejectedPaths = [
    '\\\\server\\share\\intents.json',
    '..',
    '.',
    '../outside.json',
    'a/../b.json',
    'a/..',
    './a.json',
    'a/./b.json',
    'a\\..\\b.json',
    'c:relative.json',
    '',
    'a//b.json',
    'a/',
    'a\nb/../c.json'
  ];

  for (const badPath of rejectedPaths) {
    const document = validRunManifest();
    document.info.candidate_files[0].path = badPath;
    assertInvalid(validate, document);
  }
});

test('run manifest accepts nested relative candidate paths', () => {
  const validate = validatorFor('run_manifest.schema.json');
  const acceptedPaths = [
    'intents.json',
    'knowledge/datasets/candidates/intents.json',
    '.hidden/intents.json',
    'a.b/c.d.json'
  ];

  for (const goodPath of acceptedPaths) {
    const document = validRunManifest();
    document.info.candidate_files[0].path = goodPath;
    assertValid(validate, document);
  }
});

test('run manifest rejects empty requested datasets and uppercase hashes', () => {
  const validate = validatorFor('run_manifest.schema.json');
  const emptyDatasets = validRunManifest();
  emptyDatasets.identity.requested_datasets = [];
  const uppercaseHash = validRunManifest();
  uppercaseHash.identity.input_sha256 = 'A'.repeat(64);

  assertInvalid(validate, emptyDatasets);
  assertInvalid(validate, uppercaseHash);
});

test('run manifest rejects unknown fields throughout the envelope', () => {
  const validate = validatorFor('run_manifest.schema.json');
  const unknownRoot = { ...validRunManifest(), unexpected: true };
  const unknownIdentity = validRunManifest();
  unknownIdentity.identity.generated_at = '2026-07-30T12:00:00.000Z';
  const unknownBundleEntry = validRunManifest();
  unknownBundleEntry.identity.rule_bundles.intents.path = 'rules/intents.json';
  const unknownInfo = validRunManifest();
  unknownInfo.info.run_id_basis = 'identity';
  const unknownCandidateFile = validRunManifest();
  unknownCandidateFile.info.candidate_files[0].absolute_path = '/tmp/intents.json';

  assertInvalid(validate, unknownRoot);
  assertInvalid(validate, unknownIdentity);
  assertInvalid(validate, unknownBundleEntry);
  assertInvalid(validate, unknownInfo);
  assertInvalid(validate, unknownCandidateFile);
});

test('review decisions accept valid accept, reject, and edit entries', () => {
  const validate = validatorFor('review_decisions.schema.json');

  for (const decision of ['accept', 'reject', 'edit']) {
    assertValid(validate, validReviewDecision(decision));
  }
});

test('review decisions require final_payload for edits', () => {
  const validate = validatorFor('review_decisions.schema.json');
  const document = validReviewDecision('edit');
  delete document.decisions[0].final_payload;

  assertInvalid(validate, document);
});

test('review decisions forbid final_payload for accept and reject', () => {
  const validate = validatorFor('review_decisions.schema.json');

  for (const decision of ['accept', 'reject']) {
    const document = validReviewDecision(decision);
    document.decisions[0].final_payload = { id: 'not-allowed' };
    assertInvalid(validate, document);
  }
});

test('review decisions reject non-object final_payload for edits', () => {
  const validate = validatorFor('review_decisions.schema.json');

  for (const payload of ['not-an-object', [], 42, null]) {
    const document = validReviewDecision('edit');
    document.decisions[0].final_payload = payload;
    assertInvalid(validate, document);
  }
});

test('review decisions reject invalid decision values and unknown fields', () => {
  const validate = validatorFor('review_decisions.schema.json');
  const invalidDecision = validReviewDecision('accept');
  invalidDecision.decisions[0].decision = 'approve';
  const unknownField = validReviewDecision('reject');
  unknownField.decisions[0].reviewed_at = '2026-07-30T12:00:00.000Z';

  assertInvalid(validate, invalidDecision);
  assertInvalid(validate, unknownField);
});

test('schema validator loads and compiles all extraction contract schemas', () => {
  for (const fileName of [
    'rule_bundle.schema.json',
    'candidate_file.schema.json',
    'run_manifest.schema.json',
    'review_decisions.schema.json'
  ]) {
    const schema = loadSchema(schemaPath(fileName));
    const validate = compileSchema(schema);

    assert.equal(typeof validate, 'function');
  }
});

test('schema validator returns useful errors for invalid documents', () => {
  const schema = loadSchema(schemaPath('candidate_file.schema.json'));
  const document = validCandidateFile();
  document.candidates[0].candidate_id = 'bad-id';

  const result = validateDocument(document, schema);

  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
  assert.match(formatValidationErrors(result.errors), /candidate_id/);
  assert.match(formatValidationErrors(result.errors), /pattern/);
});

test('schema validator does not mutate validated documents', () => {
  const schema = loadSchema(schemaPath('candidate_file.schema.json'));
  const validDocument = validCandidateFile();
  const validSnapshot = JSON.stringify(validDocument);
  const invalidDocument = validCandidateFile();
  invalidDocument.candidates[0].candidate_id = 'bad-id';
  const invalidSnapshot = JSON.stringify(invalidDocument);

  validateDocument(validDocument, schema);
  validateDocument(invalidDocument, schema);

  assert.equal(JSON.stringify(validDocument), validSnapshot);
  assert.equal(JSON.stringify(invalidDocument), invalidSnapshot);
});

test('schema validator formats validation errors deterministically', () => {
  const errors = [
    {
      instancePath: '/z',
      schemaPath: '#/properties/z/type',
      keyword: 'type',
      params: { type: 'string', expected: true },
      message: 'must be string'
    },
    {
      instancePath: '/a',
      schemaPath: '#/properties/a/required',
      keyword: 'required',
      params: { missingProperty: 'value' },
      message: "must have required property 'value'"
    }
  ];

  assert.equal(
    formatValidationErrors(errors),
    formatValidationErrors([...errors].reverse())
  );
  assert.match(formatValidationErrors(errors), /^\/a:/);
});

test('schema validator reports invalid schema compilation clearly', () => {
  assert.throws(
    () => compileSchema({ type: 'not-a-json-schema-type' }),
    /Schema compilation failed/
  );
});
