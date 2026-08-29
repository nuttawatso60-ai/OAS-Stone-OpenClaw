const test = require('node:test');
const assert = require('node:assert/strict');

const {
  StaffResponseDraftInputError,
  createStaffTelegramBot,
  formatCustomerResponseDraft,
  parseDraftCommand
} = require('../tools/telegram_claire');

function plan(state, overrides = {}) {
  return {
    state,
    pricing: { current: { total: 1234.5, currency: 'THB' }, historical: [] },
    responseStyle: [{ guidance: 'Explain the current pricing-engine result before historical context.' }],
    missingInformation: [],
    conflicts: [],
    evidencePointers: [{ chunk_id: 'chat.txt:0007', source_ref: 'C:\\private\\raw-chat.txt' }],
    errors: [],
    ...overrides
  };
}

test('draft command normalizes the existing staff price syntax', () => {
  assert.deepEqual(parseDraftCommand('/draft stone_sign แกรนิต 40x60 2'), {
    productType: 'stone_sign',
    material: 'granite',
    width: 40,
    height: 60,
    unit: 'cm',
    quantity: 2
  });
});

test('authorized staff can request a draft plan while unauthorized chats stay silent', async () => {
  const sent = [];
  const client = {
    async getUpdates() {
      return [
        { update_id: 1, message: { chat: { id: 1000 }, text: '/draft stone_sign granite 40x60' } },
        { update_id: 2, message: { chat: { id: 99 }, text: '/draft stone_sign granite 40x60' } }
      ];
    },
    async sendMessage(...args) { sent.push(args); }
  };
  const bot = createStaffTelegramBot({ client, allowedChatIds: new Set(['99']) });
  await bot.pollOnce();
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 99);
  assert.match(sent[0][1], /Customer Response Draft Plan/);
});

test('ready draft renders current pricing, style guidance, and safe evidence pointers', () => {
  const reply = formatCustomerResponseDraft('/draft stone_sign granite 40x60', {
    planner: () => plan('ready')
  });
  assert.match(reply, /สถานะ: ready/);
  assert.match(reply, /Pricing Engine/);
  assert.match(reply, /pricing-engine/);
  assert.match(reply, /chat\.txt:0007/);
  assert.doesNotMatch(reply, /private|raw-chat|source_ref/);
});

test('needs_information is clearly not presented as a final customer answer', () => {
  const reply = formatCustomerResponseDraft('/draft stone_sign granite 40x60', {
    planner: () => plan('needs_information', {
      pricing: { current: null, historical: [] },
      responseStyle: [],
      missingInformation: [{ field: 'height', question: 'What is the height in cm?' }]
    })
  });
  assert.match(reply, /สถานะ: needs_information/);
  assert.match(reply, /ยังไม่ใช่คำตอบสุดท้าย/);
  assert.match(reply, /What is the height in cm/);
});

test('conflict is surfaced and historical quotation remains informational', () => {
  const reply = formatCustomerResponseDraft('/draft stone_sign granite 40x60', {
    planner: () => plan('conflict', {
      pricing: {
        current: { total: 1234.5, currency: 'THB' },
        historical: [{ quotedPriceThb: 9999 }]
      },
      conflicts: [{ conflictType: 'price_mismatch' }]
    })
  });
  assert.match(reply, /สถานะ: conflict/);
  assert.match(reply, /unresolved/);
  assert.match(reply, /ข้อมูลประกอบเท่านั้น/);
  assert.match(reply, /ไม่ override Pricing Engine/);
  assert.match(reply, /ยังไม่ใช่คำตอบสุดท้าย/);
});

test('unsupported planner result fails safely without exposing input', () => {
  const secret = 'SECRET_PHONE_0800000000';
  const reply = formatCustomerResponseDraft('/draft stone_sign granite 40x60', {
    planner: () => plan('unsupported', {
      pricing: { current: null, historical: [] },
      responseStyle: [],
      errors: ['invalid_evidence_input'],
      request: { query: secret }
    })
  });
  assert.match(reply, /สถานะ: unsupported/);
  assert.match(reply, /ไม่สามารถจัดทำ draft plan/);
  assert.doesNotMatch(reply, new RegExp(secret));
});

test('draft rendering is deterministic and has no customer-send side effect', () => {
  let plannerCalls = 0;
  const planner = () => {
    plannerCalls += 1;
    return plan('ready');
  };
  const first = formatCustomerResponseDraft('/draft stone_sign granite 40x60', { planner });
  const second = formatCustomerResponseDraft('/draft stone_sign granite 40x60', { planner });
  assert.equal(first, second);
  assert.equal(plannerCalls, 2);
  assert.doesNotMatch(first, /sendMessage|customer message|forward/i);
});

test('malformed draft input fails closed', () => {
  assert.throws(
    () => parseDraftCommand('/draft stone_sign granite 40-60'),
    StaffResponseDraftInputError
  );
  assert.throws(
    () => parseDraftCommand('/draft stone sign granite 40x60'),
    StaffResponseDraftInputError
  );
});
