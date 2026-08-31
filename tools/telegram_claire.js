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

// Telegram appends "@botusername" to commands sent in groups and supergroups,
// so "/market@oas_stone_shop_bot" must resolve to the same command as "/market".
// The allowlist accepts negative group IDs specifically so the bot can serve a
// staff group, which is exactly where the suffixed form is what clients send.
function commandName(token) {
  return typeof token === 'string' ? token.split('@', 1)[0].toLowerCase() : '';
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

// Telegram is an internal market/competitor intelligence surface only. Pricing,
// customer-response drafting, target binding, approval and outbound customer
// sending are deliberately not routed here; pricing stays in the standalone
// pricing engine for the future pricing application.
function staffReply(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  // Group and supergroup clients send "/help@botusername", so dispatch on the
  // command name rather than on the raw text.
  const command = commandName(normalized.split(/\s+/, 1)[0]);

  if (command === '/start' || command === '/help') {
    return [
      'OAS Stone Market Intelligence',
      'เครื่องมือภายในสำหรับ competitor และ market intelligence เท่านั้น',
      'คำสั่งที่ใช้ได้:',
      '/market',
      '/help',
      'อ่านอย่างเดียว: ไม่มีการคำนวณราคา ไม่มีการตอบลูกค้า และไม่ส่งข้อความออกนอกทีม'
    ].join('\n');
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
    'ใช้ /help เพื่อดูคำสั่ง market intelligence ที่รองรับ'
  ].join('\n');
}

function createStaffTelegramBot({ client, allowedChatIds } = {}) {
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
      // Replies go back to the originating allowlisted staff chat only. There is
      // no path that can address any other chat.
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
  staffReply,
  parseAllowedChatIds,
  createStaffTelegramBot,
  // Compatibility aliases for callers of the original module API.
  claireReply: staffReply,
  createClaireTelegramBot: createStaffTelegramBot,
  createTelegramClient
};
