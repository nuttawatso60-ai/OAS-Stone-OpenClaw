const {
  StaffPricingInputError,
  commandName,
  parsePriceCommand,
  quoteStaffPrice
} = require('./staff_pricing');
const { planCustomerResponse, RESPONSE_STATES } = require('./customer_response_planner');
const {
  StaffDraftError,
  StaffResponseDraftStore
} = require('./staff_response_drafts');
const {
  StaffKnowledgeError,
  formatMaterials,
  formatQuiz,
  formatSizes,
  formatTraining,
  loadStaffKnowledge
} = require('./staff_knowledge');
const { MarketDataError, buildConfiguredDailyDigest } = require('./market_intelligence');

class TelegramConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TelegramConfigError';
  }
}

class TelegramApiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

class StaffResponseDraftInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StaffResponseDraftInputError';
  }
}

const DEFAULT_DRAFT_STORE = new StaffResponseDraftStore();

function requiredToken(token) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new TelegramConfigError('TELEGRAM_BOT_TOKEN is required');
  }
  return token.trim();
}

function parseAllowedChatIds(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TelegramConfigError('TELEGRAM_ALLOWED_CHAT_IDS is required');
  }

  const ids = value.split(',').map(part => part.trim());
  if (ids.some(id => !/^-?\d+$/.test(id))) {
    throw new TelegramConfigError('TELEGRAM_ALLOWED_CHAT_IDS is invalid');
  }

  const normalized = new Set(ids.map(id => String(BigInt(id))));
  if (normalized.size === 0) {
    throw new TelegramConfigError('TELEGRAM_ALLOWED_CHAT_IDS is required');
  }
  return normalized;
}

function createTelegramClient({ token, fetchImpl = globalThis.fetch } = {}) {
  const botToken = requiredToken(token);
  if (typeof fetchImpl !== 'function') {
    throw new TelegramConfigError('fetch implementation is required');
  }

  async function request(method, payload = {}) {
    let response;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      throw new TelegramApiError(`Telegram ${method} request failed`);
    }

    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new TelegramApiError(`Telegram ${method} returned invalid JSON`);
    }

    if (!response.ok || body?.ok !== true) {
      throw new TelegramApiError(`Telegram ${method} request was rejected`);
    }

    return body.result;
  }

  return {
    getUpdates({ offset, timeout = 30 } = {}) {
      const payload = { timeout, allowed_updates: ['message'] };
      if (offset !== undefined) payload.offset = offset;
      return request('getUpdates', payload);
    },
    sendMessage(chatId, text) {
      return request('sendMessage', { chat_id: chatId, text });
    }
  };
}

function parseDraftCommand(text) {
  if (typeof text !== 'string') throw new StaffResponseDraftInputError('รูปแบบคำสั่งไม่ถูกต้อง');
  const parts = text.trim().split(/\s+/);
  if (commandName(parts[0]) !== '/draft') {
    throw new StaffResponseDraftInputError('ต้องเริ่มด้วย /draft');
  }
  if (parts.length < 4 || parts.length > 5) {
    throw new StaffResponseDraftInputError('ใช้: /draft <ประเภทงาน> <วัสดุ> <กว้างxสูง> [จำนวน]');
  }
  if (!/^[a-z][a-z0-9_-]*$/i.test(parts[1])) {
    throw new StaffResponseDraftInputError('ประเภทงานต้องเป็นรหัสภาษาอังกฤษ เช่น stone_sign');
  }

  let priceInput;
  try {
    priceInput = parsePriceCommand(`/price ${parts.slice(2).join(' ')}`);
  } catch (error) {
    if (error instanceof StaffPricingInputError) {
      throw new StaffResponseDraftInputError(error.message);
    }
    throw error;
  }
  return {
    productType: parts[1],
    material: priceInput.material,
    width: priceInput.widthCm,
    height: priceInput.heightCm,
    unit: 'cm',
    quantity: priceInput.quantity
  };
}

function formatMoney(value) {
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatCustomerMessage(request, plan) {
  if (plan.state !== 'ready' || !Number.isFinite(plan.pricing?.current?.total)) return null;
  return [
    `ขอแจ้งราคา ${request.material} ขนาด ${request.width}×${request.height} ซม. จำนวน ${request.quantity}`,
    `ราคารวมประมาณ ${formatMoney(plan.pricing.current.total)} บาท`,
    'ราคานี้เป็นการประเมินเบื้องต้นและอาจเปลี่ยนแปลงตามรายละเอียดงาน'
  ].join('\n');
}

function parseTargetCommand(text) {
  const parts = typeof text === 'string' ? text.trim().split(/\s+/) : [];
  if (commandName(parts[0]) !== '/target' || parts.length !== 3) {
    throw new StaffResponseDraftInputError('ใช้: /target <draft_id> <customer_chat_id>');
  }
  if (!/^-?\d+$/.test(parts[2]) || parts[2] === '0' || parts[2] === '-0') {
    throw new StaffResponseDraftInputError('customer chat ID ต้องเป็นเลข Telegram ที่ไม่เป็นศูนย์');
  }
  return { id: parts[1], targetChatId: parts[2] };
}

async function sendCustomerTelegramMessage(client, targetChatId, text) {
  if (!client || typeof client.sendMessage !== 'function') throw new TelegramConfigError('Telegram client is required');
  if (typeof targetChatId !== 'string' || !/^-?\d+$/.test(targetChatId)) throw new TelegramConfigError('customer target is invalid');
  if (typeof text !== 'string' || text.trim() === '') throw new TelegramConfigError('customer message is required');
  return client.sendMessage(targetChatId, text);
}

function formatCustomerResponseDraft(text, { planner = planCustomerResponse } = {}) {
  if (typeof planner !== 'function') throw new StaffResponseDraftInputError('planner is unavailable');
  const request = parseDraftCommand(text);
  const plan = planner(request);
  if (!plan || !RESPONSE_STATES.includes(plan.state)) {
    throw new StaffResponseDraftInputError('ผลลัพธ์ planner ไม่ถูกต้อง');
  }

  const lines = [
    'OAS Customer Response Draft Plan',
    `สถานะ: ${plan.state}`,
    'โหมด: draft-only สำหรับ staff review; ไม่ใช่การส่งข้อความให้ลูกค้า'
  ];

  if (plan.state === 'needs_information') {
    lines.push('ยังไม่ใช่คำตอบสุดท้ายสำหรับลูกค้า', 'ต้องถามเพิ่ม:');
    for (const item of plan.missingInformation ?? []) lines.push(`- ${item.question}`);
  } else if (plan.state === 'unsupported') {
    lines.push('ไม่สามารถจัดทำ draft plan ได้');
    if (Array.isArray(plan.errors) && plan.errors.length > 0) lines.push(`เหตุผล: ${plan.errors.join(', ')}`);
  } else {
    const current = plan.pricing?.current;
    if (current && Number.isFinite(current.total)) {
      lines.push(`ราคาปัจจุบันจาก Pricing Engine: ${formatMoney(current.total)} ${current.currency ?? 'THB'}`);
    }
    if (plan.state === 'conflict') {
      lines.push('ยังไม่ใช่คำตอบสุดท้ายสำหรับลูกค้า', 'ข้อขัดแย้งด้านราคา:');
      for (const conflict of plan.conflicts ?? []) {
        lines.push(`- ${conflict.conflictType ?? 'pricing_conflict'}: unresolved`);
      }
    } else {
      lines.push('พร้อมเป็น draft ให้ staff ตรวจทานก่อนตอบลูกค้า');
    }
  }

  const historical = plan.pricing?.historical ?? [];
  if (historical.length > 0) {
    lines.push('Historical quotation (ข้อมูลประกอบเท่านั้น):');
    for (const item of historical) {
      if (Number.isFinite(item.quotedPriceThb)) lines.push(`- ${formatMoney(item.quotedPriceThb)} THB; ไม่ override Pricing Engine`);
    }
  }
  const guidance = (plan.responseStyle ?? []).map(item => item.guidance).filter(Boolean);
  if (guidance.length > 0) lines.push('แนวทาง response style:', ...guidance.map(item => `- ${item}`));
  const pointers = (plan.evidencePointers ?? []).map(item => item.chunk_id).filter(Boolean);
  if (pointers.length > 0) lines.push(`Evidence pointers: ${[...new Set(pointers)].join(', ')}`);
  return lines.join('\n');
}

function buildCustomerResponseDraft(text, { planner = planCustomerResponse } = {}) {
  const request = parseDraftCommand(text);
  const plan = planner(request);
  if (!plan || !RESPONSE_STATES.includes(plan.state)) {
    throw new StaffResponseDraftInputError('ผลลัพธ์ planner ไม่ถูกต้อง');
  }
  return { request, plan };
}

function formatPendingDraft(draft) {
  return [
    draft.renderedText,
    `Draft ID: ${draft.id}`,
    `หมดอายุ: ${new Date(draft.expiresAt).toISOString()}`,
    'ใช้ /target <draft_id> <customer_chat_id> แล้ว /approve <draft_id>; ยังไม่ส่งจนกว่าจะครบทุกขั้นตอน'
  ].join('\n');
}

function formatApprovalError(error) {
  const messages = {
    invalid_draft_id: 'Draft ID ไม่ถูกต้อง',
    unknown_draft: 'ไม่พบ draft นี้หรือหมดอายุแล้ว',
    expired_draft: 'draft หมดอายุแล้ว ไม่อนุมัติ',
    draft_already_approved: 'draft นี้อนุมัติไปแล้ว ไม่ส่งซ้ำ',
    draft_not_ready: 'draft ที่ไม่ใช่ ready อนุมัติส่งไม่ได้',
    target_required: 'ยังไม่ส่ง: ต้อง bind customer target ด้วย /target ก่อน',
    invalid_target: 'customer chat ID ไม่ถูกต้อง',
    draft_not_pending: 'draft นี้ไม่อยู่ในสถานะ pending จึง bind target ไม่ได้',
    payload_unavailable: 'ไม่สามารถส่งได้: customer payload ไม่พร้อม',
    payload_changed: 'ไม่สามารถส่งได้: customer payload เปลี่ยนแปลง',
    failed_retryable: 'ส่งไม่สำเร็จ: retry ได้โดยกด /approve ซ้ำอย่างชัดเจน',
    failed_uncertain: 'ส่งไม่สำเร็จแบบไม่แน่ชัด: ระงับการ retry เพื่อป้องกันส่งซ้ำ',
    send_unavailable: 'ไม่สามารถส่งได้: customer send primitive ไม่พร้อม',
    draft_already_sent: 'draft นี้ส่งแล้ว ไม่ส่งซ้ำ',
    send_uncertain: 'สถานะการส่งไม่แน่ชัด: ระงับการ retry เพื่อป้องกันส่งซ้ำ'
  };
  return messages[error.code] ?? 'ไม่สามารถอนุมัติ draft ได้';
}

function staffReply(text, { draftStore = DEFAULT_DRAFT_STORE, planner = planCustomerResponse } = {}) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  // Group and supergroup clients send "/help@botusername", so dispatch on the
  // command name rather than on the raw text.
  const command = commandName(normalized.split(/\s+/, 1)[0]);
  if (command === '/start' || command === '/help') {
    return [
      'OAS Stone Staff Assistant',
      'เครื่องมือภายในสำหรับเจ้าของร้านและพนักงาน',
      'คำสั่งที่ใช้ได้:',
      '/price <วัสดุ> <กว้างxสูง> [จำนวน]',
      '/draft <ประเภทงาน> <วัสดุ> <กว้างxสูง> [จำนวน]',
      '/approve <draft_id>',
      '/materials, /sizes, /train, /quiz, /market',
      'ตัวอย่าง: /price granite 30x20 2',
      'วัสดุ: granite, marble, acrylic, sandstone'
    ].join('\n');
  }

  if (command === '/price') {
    try {
      return quoteStaffPrice(normalized);
    } catch (error) {
      if (error instanceof StaffPricingInputError) return error.message;
      return 'ไม่สามารถคำนวณราคาได้';
    }
  }

  if (command === '/draft') {
    try {
      const { request, plan } = buildCustomerResponseDraft(normalized, { planner });
      const draft = draftStore.create({
        request,
        plan,
        renderedText: formatCustomerResponseDraft(normalized, { planner: () => plan }),
        customerText: formatCustomerMessage(request, plan)
      });
      return formatPendingDraft(draft);
    } catch (error) {
      if (error instanceof StaffResponseDraftInputError) return error.message;
      return 'ไม่สามารถจัดทำ draft plan ได้';
    }
  }

  if (command === '/target') {
    try {
      const target = parseTargetCommand(normalized);
      const draft = draftStore.bindTarget(target.id, target.targetChatId);
      return [
        `Draft ID: ${draft.id}`,
        `Target bound: ${draft.targetChatId}`,
        'สถานะ: pending; ยังไม่ส่งข้อความ'
      ].join('\n');
    } catch (error) {
      if (error instanceof StaffResponseDraftInputError) return error.message;
      if (error instanceof StaffDraftError) return formatApprovalError(error);
      return 'ไม่สามารถ bind customer target ได้';
    }
  }

  if (command === '/approve') {
    return formatApprovalError(new StaffDraftError('send_unavailable'));
  }

  if (['/materials', '/sizes', '/train', '/quiz'].includes(command)) {
    try {
      if (command === '/materials') return formatMaterials();
      const knowledge = loadStaffKnowledge();
      if (command === '/sizes') return formatSizes(knowledge);
      if (command === '/train') return formatTraining(knowledge);
      return formatQuiz(knowledge);
    } catch (error) {
      if (error instanceof StaffKnowledgeError) return 'ข้อมูล Staff Knowledge ไม่พร้อมใช้งาน';
      return 'ไม่สามารถแสดงข้อมูล Staff Knowledge ได้';
    }
  }

  if (command === '/market') {
    try {
      return buildConfiguredDailyDigest();
    } catch (error) {
      if (error instanceof MarketDataError) return 'ข้อมูล Market Intelligence ไม่พร้อมใช้งาน';
      return 'ไม่สามารถแสดงข้อมูล Market Intelligence ได้';
    }
  }

  return [
    'รับข้อความแล้ว',
    'ใช้ /help เพื่อดูคำสั่งที่รองรับ'
  ].join('\n');
}

function createStaffTelegramBot({ client, allowedChatIds, draftStore = new StaffResponseDraftStore() } = {}) {
  if (!client || typeof client.getUpdates !== 'function' || typeof client.sendMessage !== 'function') {
    throw new TelegramConfigError('Telegram client is required');
  }
  if (!(allowedChatIds instanceof Set) || allowedChatIds.size === 0) {
    throw new TelegramConfigError('Telegram allowed chat IDs are required');
  }

  let nextOffset;

  async function pollOnce({ timeout = 30 } = {}) {
    const updates = await client.getUpdates({ offset: nextOffset, timeout });
    if (!Array.isArray(updates)) {
      throw new TelegramApiError('Telegram getUpdates returned an invalid result');
    }

    for (const update of updates) {
      if (Number.isInteger(update?.update_id)) {
        nextOffset = Math.max(nextOffset ?? 0, update.update_id + 1);
      }

      const message = update?.message;
      if (!message || typeof message.text !== 'string' || message.chat?.id === undefined) continue;
      const chatId = String(message.chat.id);
      if (!allowedChatIds.has(chatId)) continue;
      await client.sendMessage(message.chat.id, await staffReplyAsync(message.text, {
        draftStore,
        sendCustomerMessage: (targetChatId, text) => sendCustomerTelegramMessage(client, targetChatId, text)
      }));
    }

    return { processed: updates.length, nextOffset };
  }

  return {
    pollOnce,
    getNextOffset() {
      return nextOffset;
    }
  };
}

async function staffReplyAsync(text, { draftStore = DEFAULT_DRAFT_STORE, sendCustomerMessage } = {}) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  const command = commandName(normalized.split(/\s+/, 1)[0]);
  if (command !== '/approve') return staffReply(normalized, { draftStore });
  const parts = normalized.split(/\s+/);
  if (parts.length !== 2) return 'ใช้: /approve <draft_id>';
  try {
    const draft = await draftStore.approveAndSend(parts[1], sendCustomerMessage);
    return [
      `อนุมัติและส่ง draft ${draft.id} แล้ว`,
      `Target: ${draft.targetChatId}`,
      'สถานะ: sent'
    ].join('\n');
  } catch (error) {
    if (error instanceof StaffDraftError) return formatApprovalError(error);
    return 'ไม่สามารถส่ง customer message ได้';
  }
}

module.exports = {
  TelegramApiError,
  TelegramConfigError,
  StaffResponseDraftInputError,
  StaffDraftError,
  StaffResponseDraftStore,
  staffReply,
  parseDraftCommand,
  buildCustomerResponseDraft,
  formatCustomerResponseDraft,
  formatCustomerMessage,
  parseTargetCommand,
  sendCustomerTelegramMessage,
  staffReplyAsync,
  parseAllowedChatIds,
  createStaffTelegramBot,
  // Compatibility aliases for callers of the original module API.
  claireReply: staffReply,
  createClaireTelegramBot: createStaffTelegramBot,
  createTelegramClient
};
