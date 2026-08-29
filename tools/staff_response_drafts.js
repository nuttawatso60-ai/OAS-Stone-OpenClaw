'use strict';

const crypto = require('node:crypto');

const DRAFT_TTL_MS = 15 * 60 * 1000;
const DRAFT_ID_PATTERN = /^draft_[a-f0-9]{16}$/;

class StaffDraftError extends Error {
  constructor(code) {
    super(code);
    this.name = 'StaffDraftError';
    this.code = code;
  }
}

function draftId(request, plan) {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify({ request, plan }))
    .digest('hex');
  return `draft_${digest.slice(0, 16)}`;
}

class StaffResponseDraftStore {
  constructor({ ttlMs = DRAFT_TTL_MS, now = () => Date.now() } = {}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new TypeError('ttlMs must be a positive safe integer');
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    this.ttlMs = ttlMs;
    this.now = now;
    this.pending = new Map();
  }

  create({ request, plan, renderedText }) {
    const createdAt = this.now();
    const id = draftId(request, plan);
    this.pending.set(id, {
      id,
      status: 'pending',
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      request,
      plan: {
        state: plan.state,
        pricing: plan.pricing,
        responseStyle: plan.responseStyle,
        missingInformation: plan.missingInformation,
        conflicts: plan.conflicts,
        evidencePointers: plan.evidencePointers,
        errors: plan.errors
      },
      renderedText
    });
    return this.pending.get(id);
  }

  approve(id) {
    if (typeof id !== 'string' || !DRAFT_ID_PATTERN.test(id)) {
      throw new StaffDraftError('invalid_draft_id');
    }
    const draft = this.pending.get(id);
    if (!draft) throw new StaffDraftError('unknown_draft');
    if (this.now() >= draft.expiresAt) {
      draft.status = 'expired';
      throw new StaffDraftError('expired_draft');
    }
    if (draft.status !== 'pending') throw new StaffDraftError('draft_already_approved');
    if (draft.plan?.state !== 'ready') throw new StaffDraftError('draft_not_ready');

    // Customer routing/send is intentionally disabled until an approved target
    // primitive exists. Marking approval is idempotent and never sends here.
    draft.status = 'approved';
    draft.approvedAt = this.now();
    draft.sendStatus = 'disabled_no_customer_target';
    return draft;
  }

  get(id) {
    return this.pending.get(id);
  }
}

module.exports = {
  DRAFT_TTL_MS,
  StaffDraftError,
  StaffResponseDraftStore,
  draftId
};
