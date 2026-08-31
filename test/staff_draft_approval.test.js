const test = require('node:test');
const assert = require('node:assert/strict');

const {
  StaffDraftError,
  StaffResponseDraftStore
} = require('../tools/staff_response_drafts');
const {
  createStaffTelegramBot,
  staffReply,
  staffReplyAsync
} = require('../tools/telegram_claire');

function readyPlan(overrides = {}) {
  return {
    state: 'ready',
    pricing: {
      authority: 'pricing_engine',
      current: { total: 1234.5, currency: 'THB' },
      historical: [{ quotationId: 'q1', quotedPriceThb: 1200 }]
    },
    responseStyle: [{ guidance: 'Use reviewed style.' }],
    missingInformation: [],
    conflicts: [],
    evidencePointers: [{ chunk_id: 'chat.txt:0007', source_ref: 'private/raw.txt' }],
    errors: [],
    ...overrides
  };
}

function request() {
  return { productType: 'stone_sign', material: 'granite', width: 40, height: 60, unit: 'cm', quantity: 1 };
}

function createDraft(store, plan = readyPlan()) {
  return store.create({
    request: request(),
    plan,
    renderedText: 'draft text',
    customerText: plan.state === 'ready' ? 'ราคารวมประมาณ 1234.50 บาท' : null
  });
}

test('/draft creates pending state and never invokes a customer sender', () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const reply = staffReply('/draft stone_sign granite 40x60', {
    draftStore: store,
    planner: () => readyPlan()
  });
  const id = reply.match(/Draft ID: (draft_[a-f0-9]{16})/)?.[1];
  assert.ok(id);
  assert.equal(store.get(id).status, 'pending');
  assert.doesNotMatch(reply, /sendMessage|customer target/i);
});

test('unauthorized chat cannot create or approve a pending draft', async () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  const sent = [];
  const bot = createStaffTelegramBot({
    client: {
      async getUpdates() {
        return [
          { update_id: 1, message: { chat: { id: 1000 }, text: `/target ${draft.id} -100123` } },
          { update_id: 2, message: { chat: { id: 1000 }, text: `/approve ${draft.id}` } }
        ];
      },
      async sendMessage(...args) { sent.push(args); }
    },
    allowedChatIds: new Set(['99']),
    draftStore: store
  });
  await bot.pollOnce();
  assert.equal(store.get(draft.id).status, 'pending');
  assert.deepEqual(sent, []);
});

test('ready draft can be approved once and repeated approval is idempotently rejected', () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  const approved = store.approve(draft.id);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.sendStatus, 'disabled_no_customer_target');
  assert.throws(() => store.approve(draft.id), error =>
    error instanceof StaffDraftError && error.code === 'draft_already_approved'
  );
});

test('approval cannot send when customer routing is unavailable', async () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  const reply = await staffReplyAsync(`/approve ${draft.id}`, { draftStore: store });
  assert.equal(draft.status, 'pending');
  assert.equal(draft.sendStatus, undefined);
  assert.match(reply, /ต้อง bind customer target/);
});

test('expired, malformed, and unknown draft IDs fail closed', () => {
  let now = 1000;
  const store = new StaffResponseDraftStore({ now: () => now, ttlMs: 10 });
  const draft = createDraft(store);
  now = 1010;
  assert.throws(() => store.approve(draft.id), error =>
    error instanceof StaffDraftError && error.code === 'expired_draft'
  );
  assert.throws(() => store.approve('draft_bad'), error =>
    error instanceof StaffDraftError && error.code === 'invalid_draft_id'
  );
  assert.throws(() => store.approve('draft_0000000000000000'), error =>
    error instanceof StaffDraftError && error.code === 'unknown_draft'
  );
});

test('non-ready states cannot be approved or sent', () => {
  for (const state of ['needs_information', 'conflict', 'unsupported']) {
    const store = new StaffResponseDraftStore({ now: () => 1000 });
    const draft = createDraft(store, readyPlan({ state }));
    assert.throws(() => store.approve(draft.id), error =>
      error instanceof StaffDraftError && error.code === 'draft_not_ready'
    );
    assert.equal(draft.status, 'pending');
  }
});

test('approval preserves pricing authority and evidence pointers without exposing PII', () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store, readyPlan({
    evidencePointers: [{ chunk_id: 'chat.txt:0008', source_ref: 'raw/customer-phone.txt' }]
  }));
  store.approve(draft.id);
  assert.equal(draft.plan.pricing.authority, 'pricing_engine');
  assert.equal(draft.plan.pricing.current.total, 1234.5);
  assert.equal(draft.plan.evidencePointers[0].chunk_id, 'chat.txt:0008');
  const reply = staffReply(`/approve ${draft.id}`, { draftStore: store });
  assert.match(reply, /customer send primitive ไม่พร้อม/);
  assert.doesNotMatch(reply, /raw\/customer-phone|080000|secret/i);
});

test('draft IDs are deterministic for the same normalized request and plan', () => {
  const first = createDraft(new StaffResponseDraftStore({ now: () => 1000 }));
  const second = createDraft(new StaffResponseDraftStore({ now: () => 9000 }));
  assert.equal(first.id, second.id);
});

test('/target binds a numeric customer ID without sending', () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  const reply = staffReply(`/target ${draft.id} -100123`, { draftStore: store });
  assert.match(reply, /Target bound: -100123/);
  assert.equal(draft.targetChatId, '-100123');
  assert.equal(draft.status, 'pending');
});

test('malformed target, unknown target draft, and rebinding sent draft fail closed', () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  assert.match(staffReply(`/target ${draft.id} abc`, { draftStore: store }), /customer chat ID/);
  assert.match(staffReply('/target draft_0000000000000000 -100123', { draftStore: store }), /ไม่พบ draft/);
  draft.targetChatId = '-100123';
  draft.status = 'sent';
  assert.match(staffReply(`/target ${draft.id} -100456`, { draftStore: store }), /bind target ไม่ได้/);
});

test('expired draft cannot bind a target', () => {
  let now = 1000;
  const store = new StaffResponseDraftStore({ now: () => now, ttlMs: 10 });
  const draft = createDraft(store);
  now = 1010;
  assert.match(staffReply(`/target ${draft.id} -100123`, { draftStore: store }), /หมดอายุ/);
  assert.equal(draft.status, 'expired');
});

test('authorized ready draft sends the immutable customer payload exactly once', async () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store, readyPlan({
    evidencePointers: [{ chunk_id: 'chat.txt:0009', source_ref: 'private/chat.txt' }]
  }));
  staffReply(`/target ${draft.id} -100123`, { draftStore: store });
  const sends = [];
  const first = await staffReplyAsync(`/approve ${draft.id}`, {
    draftStore: store,
    sendCustomerMessage: async (target, text) => sends.push({ target, text })
  });
  assert.match(first, /สถานะ: sent/);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].target, '-100123');
  assert.doesNotMatch(sends[0].text, /chat\.txt|private|Pricing Engine|evidence|conflict|draft_/i);
  assert.match(sends[0].text, /ราคารวมประมาณ/);
  const second = await staffReplyAsync(`/approve ${draft.id}`, {
    draftStore: store,
    sendCustomerMessage: async (...args) => sends.push(args)
  });
  assert.match(second, /ส่งแล้ว ไม่ส่งซ้ำ/);
  assert.equal(sends.length, 1);
});

test('authorized Telegram approval uses the existing client for one customer send', async () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  const calls = [];
  let updateBatch = [
    { update_id: 1, message: { chat: { id: 99 }, text: `/target ${draft.id} -100128` } },
    { update_id: 2, message: { chat: { id: 99 }, text: `/approve ${draft.id}` } }
  ];
  const bot = createStaffTelegramBot({
    allowedChatIds: new Set(['99']),
    draftStore: store,
    client: {
      async getUpdates() { return updateBatch; },
      async sendMessage(target, text) { calls.push({ target, text }); }
    }
  });
  await bot.pollOnce();
  const customerCalls = calls.filter(call => call.target === '-100128');
  assert.equal(customerCalls.length, 1);
  assert.match(customerCalls[0].text, /ราคารวมประมาณ/);
  assert.equal(store.get(draft.id).status, 'sent');
  updateBatch = [{ update_id: 3, message: { chat: { id: 99 }, text: `/approve ${draft.id}` } }];
  await bot.pollOnce();
  assert.equal(calls.filter(call => call.target === '-100128').length, 1);
});

test('target is required before approval and non-ready drafts cannot send', async () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  const noTarget = await staffReplyAsync(`/approve ${draft.id}`, {
    draftStore: store,
    sendCustomerMessage: async () => assert.fail('sender must not run')
  });
  assert.match(noTarget, /bind customer target/);
  for (const state of ['needs_information', 'conflict', 'unsupported']) {
    const nonReady = createDraft(store, readyPlan({ state }));
    staffReply(`/target ${nonReady.id} -100124`, { draftStore: store });
    const reply = await staffReplyAsync(`/approve ${nonReady.id}`, {
      draftStore: store,
      sendCustomerMessage: async () => assert.fail('sender must not run')
    });
    assert.match(reply, /ไม่ใช่ ready/);
  }
});

test('clear send failure permits deliberate retry, ambiguous failure blocks retry', async () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  staffReply(`/target ${draft.id} -100125`, { draftStore: store });
  let attempts = 0;
  const retryable = async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('clear failure'), { retryable: true });
  };
  assert.match(await staffReplyAsync(`/approve ${draft.id}`, { draftStore: store, sendCustomerMessage: retryable }), /retry ได้/);
  assert.equal(draft.status, 'pending');
  assert.match(await staffReplyAsync(`/approve ${draft.id}`, { draftStore: store, sendCustomerMessage: retryable }), /สถานะ: sent/);
  assert.equal(attempts, 2);

  const uncertain = createDraft(store);
  staffReply(`/target ${uncertain.id} -100126`, { draftStore: store });
  const failing = async () => { throw new Error('ambiguous failure'); };
  assert.match(await staffReplyAsync(`/approve ${uncertain.id}`, { draftStore: store, sendCustomerMessage: failing }), /ไม่แน่ชัด/);
  assert.match(await staffReplyAsync(`/approve ${uncertain.id}`, { draftStore: store, sendCustomerMessage: retryable }), /ระงับการ retry/);
  assert.equal(attempts, 2);
});

test('payload fingerprint rejects changes after draft creation', async () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  staffReply(`/target ${draft.id} -100127`, { draftStore: store });
  draft.customerText += ' changed';
  const reply = await staffReplyAsync(`/approve ${draft.id}`, {
    draftStore: store,
    sendCustomerMessage: async () => assert.fail('changed payload must not send')
  });
  assert.match(reply, /เปลี่ยนแปลง/);
  assert.equal(draft.status, 'pending');
});
