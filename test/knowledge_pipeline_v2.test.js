const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const Ajv2020 = require('ajv/dist/2020');

const schemaDir = path.join(__dirname, '..', 'knowledge', 'datasets', 'schemas');

const fixtures = {
  'candidate_file.schema.json': {
    valid: {
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
          message_indexes: [0],
          payload: { id: 'ask_price' }
        }
      ]
    },
    invalid: {
      schema_version: '1.0',
      run_id: 'bad-run',
      dataset: 'intents',
      candidates: []
    }
  },
  'chat_index.schema.json': {
    valid: {
      schema_version: '1.0',
      items: [{
        id: 'chat.txt:0001',
        source_ref: 'chat.txt',
        content_sha256: 'a'.repeat(64),
        message_range: { start: 0, end: 1 },
        tags: ['price_quote'],
        search_terms: ['synthetic'],
        status: 'indexed'
      }]
    },
    invalid: {
      schema_version: '1.0',
      items: [{
        id: 'bad',
        source_ref: '../raw/chat.txt',
        content_sha256: 'bad',
        message_range: { start: -1, end: 0 },
        tags: [],
        search_terms: [],
        status: 'bad'
      }]
    }
  },
  'conversation_outcomes.schema.json': {
    valid: {
      schema_version: '1.0',
      items: [
        {
          id: 'outcome_follow_up',
          outcome: 'follow_up',
          definition_th: 'synthetic outcome definition',
          count: 1,
          status: 'draft'
        }
      ]
    },
    invalid: {
      schema_version: '1.0',
      items: [{ id: 'bad-outcome', outcome: 'waiting', definition_th: '', status: 'active' }]
    }
  },
  'faq.schema.json': {
    valid: {
      schema_version: '1.0',
      items: [
        {
          id: 'faq_installation',
          question_th: 'synthetic question',
          answer_th: 'synthetic answer',
          intent_ids: ['ask_installation'],
          status: 'approved'
        }
      ]
    },
    invalid: {
      schema_version: '1.0',
      items: [{ id: 'faq_installation', question_th: '', answer_th: '', status: 'active' }]
    }
  },
  'intents.schema.json': {
    valid: {
      schema_version: '1.0',
      items: [
        {
          id: 'ask_price',
          label_th: 'synthetic label',
          description: 'synthetic description',
          examples: ['synthetic example'],
          status: 'draft'
        }
      ]
    },
    invalid: {
      schema_version: '1.0',
      items: [{ id: 'Ask Price', label_th: '', description: '', examples: ['x'], status: 'active' }]
    }
  },
  'objections.schema.json': {
    valid: {
      schema_version: '1.0',
      items: [
        {
          id: 'obj_price_high',
          topic: 'synthetic topic',
          objection_th: 'synthetic objection',
          response_th: 'synthetic response',
          handoff_required: false,
          status: 'draft'
        }
      ]
    },
    invalid: {
      schema_version: '1.0',
      items: [{ id: 'obj-price', topic: '', objection_th: '', response_th: '', status: 'active' }]
    }
  },
  'processed_conversations.schema.json': {
    valid: {
      schema_version: '1.0',
      items: [
        {
          id: 'processed_conversation_0123456789abcdef01234567',
          schema_version: '1.0',
          source_ref: '2026/07/chat.txt',
          source_path: '2026/07/chat.txt',
          content_sha256: 'a'.repeat(64),
          normalized_at: '2026-07-13T00:00:00.000Z',
          status: 'normalized',
          messages: [
            { index: 0, speaker: 'customer', text: 'synthetic message' },
            { index: 1, speaker: 'unknown', text: '' }
          ]
        }
      ]
    },
    invalid: {
      schema_version: '1.0',
      items: [
        {
          id: 'processed-conversation-bad',
          schema_version: '1.0',
          source_ref: '../raw/chat.txt',
          source_path: '../raw/chat.txt',
          content_sha256: 'bad',
          normalized_at: 'not-a-date',
          status: 'approved',
          messages: [{ index: -1, speaker: '', text: 'x' }]
        }
      ]
    }
  },
  'products.schema.json': {
    valid: {
      schema_version: '1.0',
      items: [
        {
          id: 'product_stone_sign',
          name_th: 'synthetic product',
          description_th: 'synthetic description',
          materials: ['synthetic material'],
          capabilities: ['synthetic capability'],
          status: 'approved'
        }
      ]
    },
    invalid: {
      schema_version: '1.0',
      items: [{ id: 'product-stone', name_th: '', description_th: '', status: 'active' }]
    }
  },
  'quotations.schema.json': {
    valid: {
      schema_version: '1.0',
      items: [
        {
          id: 'quote_stone_sign',
          product_type: 'synthetic product',
          requirements: ['synthetic requirement'],
          outcome: 'quoted',
          price_range_thb: { min: 1000, max: 2000 },
          status: 'draft'
        }
      ]
    },
    invalid: {
      schema_version: '1.0',
      items: [
        {
          id: 'quote-stone',
          product_type: '',
          requirements: ['synthetic requirement'],
          outcome: 'pending',
          price_range_thb: { min: -1 },
          status: 'active'
        }
      ]
    }
  },
  'response_style_examples.schema.json': {
    valid: {
      schema_version: '1.0',
      items: [{
        id: 'style_price_01',
        topic: 'price',
        example_type: 'price_explanation',
        evidence: {
          source_ref: 'chat.txt',
          chunk_id: 'chat.txt:0001',
          message_range: { start: 0, end: 1 }
        },
        sanitized_example: 'synthetic response example',
        status: 'candidate'
      }]
    },
    invalid: {
      schema_version: '1.0',
      items: [{
        id: 'bad-style',
        topic: '',
        example_type: 'unknown',
        evidence: {},
        sanitized_example: '',
        status: 'bad'
      }]
    }
  },
  'review_decisions.schema.json': {
    valid: {
      schema_version: '1.0',
      run_id: 'run_0123456789abcdef',
      reviewed_by: 'synthetic-reviewer',
      decisions: [
        {
          candidate_id: 'cand_0123456789abcdef01234567',
          decision: 'accept'
        }
      ]
    },
    invalid: {
      schema_version: '1.0',
      run_id: 'run_0123456789abcdef',
      reviewed_by: 'synthetic-reviewer',
      decisions: [
        {
          candidate_id: 'cand_0123456789abcdef01234567',
          decision: 'edit'
        }
      ]
    }
  },
  'rule_bundle.schema.json': {
    valid: {
      schema_version: '1.0',
      dataset: 'intents',
      rules: [
        {
          rule_id: 'intent_price_question',
          rule_version: 1,
          kind: 'keyword_any',
          enabled: true,
          match: { keywords: ['price'] },
          emit: { intent: 'ask_price' }
        }
      ]
    },
    invalid: {
      schema_version: '1.0',
      dataset: 'unknown',
      rules: []
    }
  },
  'run_manifest.schema.json': {
    valid: {
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
    },
    invalid: {
      schema_version: '1.0',
      run_id: 'bad-run',
      identity: {},
      info: {}
    }
  },
  'vocabulary.schema.json': {
    valid: {
      schema_version: '1.0',
      items: [
        {
          id: 'term_material',
          term_th: 'synthetic term',
          synonyms_th: ['synthetic synonym'],
          definition_th: 'synthetic definition',
          category: 'synthetic category',
          status: 'approved'
        }
      ]
    },
    invalid: {
      schema_version: '1.0',
      items: [{ id: 'term-material', term_th: '', definition_th: '', status: 'active' }]
    }
  }
};

function schemaFiles() {
  return fs.readdirSync(schemaDir)
    .filter(fileName => fileName.endsWith('.schema.json'))
    .sort();
}

function readSchema(fileName) {
  const filePath = path.join(schemaDir, fileName);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function compileSchemas() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return schemaFiles().map(fileName => {
    const schema = readSchema(fileName);
    return { fileName, schema, validate: ajv.compile(schema) };
  });
}

test('Knowledge Pipeline v2 schema files are valid JSON', () => {
  const files = schemaFiles();

  assert.deepEqual(files, Object.keys(fixtures).sort());

  for (const fileName of files) {
    assert.doesNotThrow(() => readSchema(fileName), fileName);
  }
});

test('Knowledge Pipeline v2 schemas compile with AJV', () => {
  assert.doesNotThrow(() => compileSchemas());
});

test('Knowledge Pipeline v2 synthetic valid fixtures pass', () => {
  for (const { fileName, validate } of compileSchemas()) {
    assert.equal(validate(fixtures[fileName].valid), true, fileName);
  }
});

test('Knowledge Pipeline v2 synthetic invalid fixtures are rejected', () => {
  for (const { fileName, validate } of compileSchemas()) {
    assert.equal(validate(fixtures[fileName].invalid), false, fileName);
    assert.ok(validate.errors?.length > 0, fileName);
  }
});

test('Knowledge Pipeline v2 schemas reject unknown fields when additionalProperties is false', () => {
  for (const { fileName, schema, validate } of compileSchemas()) {
    if (schema.additionalProperties === false) {
      const withRootUnknown = {
        ...fixtures[fileName].valid,
        unexpected_root_field: true
      };

      assert.equal(validate(withRootUnknown), false, `${fileName} root additionalProperties`);
    }

    if (schema.properties?.items?.items?.additionalProperties === false) {
      const withItemUnknown = {
        ...fixtures[fileName].valid,
        items: [
          {
            ...fixtures[fileName].valid.items[0],
            unexpected_item_field: true
          }
        ]
      };

      assert.equal(validate(withItemUnknown), false, `${fileName} item additionalProperties`);
    }
  }
});
