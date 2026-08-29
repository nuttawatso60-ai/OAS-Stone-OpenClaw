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

  create({ request, plan, renderedText, customerText = null }) {
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
      renderedText,
      customerText,
      payloadHash: customerText === null || customerText === undefined
        ? null
        : crypto.createHash('sha256').update(customerText).digest('hex')
    });
    return this.pending.get(id);
  }

  bindTarget(id, targetChatId) {
    if (typeof id !== 'string' || !DRAFT_ID_PATTERN.test(id)) {
      throw new StaffDraftError('invalid_draft_id');
    }
    const draft = this.pending.get(id);
    if (!draft) throw new StaffDraftError('unknown_draft');
    if (this.now() >= draft.expiresAt) {
      draft.status = 'expired';
      throw new StaffDraftError('expired_draft');
    }
    if (draft.status !== 'pending') throw new StaffDraftError('draft_not_pending');
    if (typeof targetChatId !== 'string' || !/^-?\d+$/.test(targetChatId)) {
      throw new StaffDraftError('invalid_target');
    }
    let normalized;
    try {
      normalized = String(BigInt(targetChatId));
    } catch (error) {
      throw new StaffDraftError('invalid_target');
    }
    if (normalized === '0') throw new StaffDraftError('invalid_target');
    draft.targetChatId = normalized;
    return draft;
  }

  async approveAndSend(id, sendCustomerMessage) {
    const draft = this._eligibleDraft(id);
    if (!draft.targetChatId) throw new StaffDraftError('target_required');
    if (!draft.customerText || !draft.payloadHash) throw new StaffDraftError('payload_unavailable');
    const currentHash = crypto.createHash('sha256').update(draft.customerText).digest('hex');
    if (currentHash !== draft.payloadHash) throw new StaffDraftError('payload_changed');
    if (typeof sendCustomerMessage !== 'function') throw new StaffDraftError('send_unavailable');
    draft.status = 'sending';
    try {
      await sendCustomerMessage(draft.targetChatId, draft.customerText);
    } catch (error) {
      draft.status = 'pending';
      draft.sendStatus = error?.retryable === true ? 'failed_retryable' : 'failed_uncertain';
      throw new StaffDraftError(draft.sendStatus);
    }
    draft.status = 'sent';
    draft.approvedAt = this.now();
    draft.sentAt = this.now();
    draft.sendStatus = 'sent';
    return draft;
  }

  _eligibleDraft(id) {
    if (typeof id !== 'string' || !DRAFT_ID_PATTERN.test(id)) {
      throw new StaffDraftError('invalid_draft_id');
    }
    const draft = this.pending.get(id);
    if (!draft) throw new StaffDraftError('unknown_draft');
    if (this.now() >= draft.expiresAt) {
      draft.status = 'expired';
      throw new StaffDraftError('expired_draft');
    }
    if (draft.status !== 'pending') throw new StaffDraftError('draft_already_sent');
    if (draft.sendStatus === 'failed_uncertain') throw new StaffDraftError('send_uncertain');
    if (draft.plan?.state !== 'ready') throw new StaffDraftError('draft_not_ready');
    return draft;
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
