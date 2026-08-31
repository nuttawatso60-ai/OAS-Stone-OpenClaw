// These tests cover tools/staff_response_drafts.js as a standalone module only.
// The draft/target/approve lifecycle is no longer wired into the Telegram
// runtime: Telegram is internal market/competitor intelligence only. The module
// is kept unwired rather than deleted so it stays available to a future
// non-Telegram surface.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  StaffDraftError,
  StaffResponseDraftStore
} = require('../tools/staff_response_drafts');

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

test('the draft module is not reachable from the Telegram module surface', () => {
  const telegram = require('../tools/telegram_claire');
  for (const removed of [
    'staffReplyAsync',
    'parseDraftCommand',
    'buildCustomerResponseDraft',
    'formatCustomerResponseDraft',
    'formatCustomerMessage',
    'parseTargetCommand',
    'sendCustomerTelegramMessage',
    'parseCustomerSendEnabled',
    'StaffResponseDraftStore',
    'StaffDraftError'
  ]) {
    assert.equal(telegram[removed], undefined, `telegram_claire still exports ${removed}`);
  }
});

test('a new draft starts pending and records no send state', () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  assert.equal(draft.status, 'pending');
  assert.equal(draft.sendStatus, undefined);
  assert.equal(draft.targetChatId, undefined);
  assert.equal(store.getPendingCount(), 1);
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

test('non-ready states cannot be approved or sent', async () => {
  for (const state of ['needs_information', 'conflict', 'unsupported']) {
    const store = new StaffResponseDraftStore({ now: () => 1000 });
    const draft = createDraft(store, readyPlan({ state }));
    assert.throws(() => store.approve(draft.id), error =>
      error instanceof StaffDraftError && error.code === 'draft_not_ready'
    );
    await assert.rejects(
      () => store.approveAndSend(draft.id, async () => assert.fail('must not send')),
      error => error instanceof StaffDraftError && error.code === 'draft_not_ready'
    );
    assert.equal(draft.status, 'pending');
  }
});

test('approval preserves pricing authority and evidence pointers', () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store, readyPlan({
    evidencePointers: [{ chunk_id: 'chat.txt:0008', source_ref: 'raw/customer-phone.txt' }]
  }));
  store.approve(draft.id);
  assert.equal(draft.plan.pricing.authority, 'pricing_engine');
  assert.equal(draft.plan.pricing.current.total, 1234.5);
  assert.equal(draft.plan.evidencePointers[0].chunk_id, 'chat.txt:0008');
});

test('draft IDs are deterministic for the same normalized request and plan', () => {
  const first = createDraft(new StaffResponseDraftStore({ now: () => 1000 }));
  const second = createDraft(new StaffResponseDraftStore({ now: () => 9000 }));
  assert.equal(first.id, second.id);
});

test('bindTarget stores a normalized numeric ID without sending', () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  const bound = store.bindTarget(draft.id, '-100123');
  assert.equal(bound.targetChatId, '-100123');
  assert.equal(bound.status, 'pending');
});

test('malformed target, unknown draft, and non-pending draft fail closed', () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  assert.throws(() => store.bindTarget(draft.id, 'abc'), error =>
    error instanceof StaffDraftError && error.code === 'invalid_target'
  );
  assert.throws(() => store.bindTarget(draft.id, '0'), error =>
    error instanceof StaffDraftError && error.code === 'invalid_target'
  );
  assert.throws(() => store.bindTarget('draft_0000000000000000', '-100123'), error =>
    error instanceof StaffDraftError && error.code === 'unknown_draft'
  );
  draft.status = 'sent';
  assert.throws(() => store.bindTarget(draft.id, '-100456'), error =>
    error instanceof StaffDraftError && error.code === 'draft_not_pending'
  );
});

test('expired draft cannot bind a target', () => {
  let now = 1000;
  const store = new StaffResponseDraftStore({ now: () => now, ttlMs: 10 });
  const draft = createDraft(store);
  now = 1010;
  assert.throws(() => store.bindTarget(draft.id, '-100123'), error =>
    error instanceof StaffDraftError && error.code === 'expired_draft'
  );
  assert.equal(draft.status, 'expired');
});

test('approveAndSend requires a bound target and makes no call without one', async () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  await assert.rejects(
    () => store.approveAndSend(draft.id, async () => assert.fail('must not send'), { sendEnabled: true }),
    error => error instanceof StaffDraftError && error.code === 'target_required'
  );
  assert.equal(draft.status, 'pending');
});

test('approveAndSend defaults to dry run and makes zero send calls', async () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  store.bindTarget(draft.id, '-100129');
  const calls = [];
  const result = await store.approveAndSend(draft.id, async (...args) => calls.push(args));
  assert.equal(result.sendStatus, 'dry_run');
  assert.equal(calls.length, 0);
  assert.equal(draft.status, 'pending');
});

test('payload fingerprint rejects changes after draft creation', async () => {
  const store = new StaffResponseDraftStore({ now: () => 1000 });
  const draft = createDraft(store);
  store.bindTarget(draft.id, '-100127');
  draft.customerText += ' changed';
  await assert.rejects(
    () => store.approveAndSend(draft.id, async () => assert.fail('changed payload must not send'), { sendEnabled: true }),
    error => error instanceof StaffDraftError && error.code === 'payload_changed'
  );
  assert.equal(draft.status, 'pending');
});

test('expired cleanup removes drafts and a new store has no restart state', () => {
  let now = 1000;
  const store = new StaffResponseDraftStore({ now: () => now, ttlMs: 10 });
  createDraft(store);
  now = 1010;
  assert.equal(store.cleanupExpired(), 1);
  assert.equal(store.getPendingCount(), 0);
  assert.equal(new StaffResponseDraftStore({ now: () => now }).getPendingCount(), 0);
});
