const { StaffPricingInputError, quoteStaffPrice } = require('./staff_pricing');

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

function staffReply(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (normalized === '/start' || normalized === '/help') {
    return [
      'OAS Stone Staff Assistant',
      'เครื่องมือภายในสำหรับเจ้าของร้านและพนักงาน',
      'คำสั่งที่ใช้ได้:',
      '/price <วัสดุ> <กว้างxสูง> [จำนวน]',
      'ตัวอย่าง: /price granite 30x20 2',
      'วัสดุ: granite, marble, acrylic, sandstone'
    ].join('\n');
  }

  if (normalized === '/price' || normalized.startsWith('/price ')) {
    try {
      return quoteStaffPrice(normalized);
    } catch (error) {
      if (error instanceof StaffPricingInputError) return error.message;
      return 'ไม่สามารถคำนวณราคาได้';
    }
  }

  return [
    'รับข้อความแล้ว',
    'ใช้ /help เพื่อดูคำสั่งที่รองรับ'
  ].join('\n');
}

function createClaireTelegramBot({ client, allowedChatIds } = {}) {
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
      await client.sendMessage(message.chat.id, staffReply(message.text));
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

module.exports = {
  TelegramApiError,
  TelegramConfigError,
  claireReply: staffReply,
  staffReply,
  parseAllowedChatIds,
  createClaireTelegramBot,
  createTelegramClient
};
