const test = require('node:test');
const assert = require('node:assert/strict');

const {
  StaffDraftError,
  StaffResponseDraftStore
} = require('../tools/staff_response_drafts');
const {
  createStaffTelegramBot,
  staffReply
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
  return store.create({ request: request(), plan, renderedText: 'draft text' });
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
        return [{ update_id: 1, message: { chat: { id: 1000 }, text: `/approve ${draft.id}` } }];
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

test('approval records approval but does not send when customer routing is unavailable', () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  const reply = staffReply(`/approve ${draft.id}`, { draftStore: store });
  assert.equal(draft.status, 'approved');
  assert.equal(draft.sendStatus, 'disabled_no_customer_target');
  assert.match(reply, /ยังไม่ส่งให้ลูกค้า/);
  assert.match(reply, /ไม่พบ customer target/);
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
  assert.match(reply, /ไม่ส่งซ้ำ/);
  assert.doesNotMatch(reply, /raw\/customer-phone|080000|secret/i);
});

test('draft IDs are deterministic for the same normalized request and plan', () => {
  const first = createDraft(new StaffResponseDraftStore({ now: () => 1000 }));
  const second = createDraft(new StaffResponseDraftStore({ now: () => 9000 }));
  assert.equal(first.id, second.id);
});
