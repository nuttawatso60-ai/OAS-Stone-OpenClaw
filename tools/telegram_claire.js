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

function claireReply(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (normalized === '/start' || normalized === '/help') {
    return [
      'สวัสดีค่ะ Claire จาก อ.เอ.เอส แกะสลัก',
      'ส่งรายละเอียดงานป้ายมาได้เลย โดยระบุ ขนาด, ชนิดหิน, ข้อความที่ต้องการแกะ และจำนวน',
      'ตอนนี้ช่องทาง Telegram อยู่ในขั้นเชื่อมต่อระบบรับงาน จึงยังไม่บันทึกคำสั่งซื้ออัตโนมัติ'
    ].join('\n');
  }

  return [
    'ได้รับข้อความแล้วค่ะ',
    'กรุณาระบุ ขนาดป้าย, ชนิดหิน, ข้อความที่ต้องการแกะ และจำนวน',
    'Claire จะใช้ข้อมูลนี้สำหรับขั้นตอนประเมินราคาในระบบ'
  ].join('\n');
}

function createClaireTelegramBot({ client } = {}) {
  if (!client || typeof client.getUpdates !== 'function' || typeof client.sendMessage !== 'function') {
    throw new TelegramConfigError('Telegram client is required');
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
      await client.sendMessage(message.chat.id, claireReply(message.text));
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
  claireReply,
  createClaireTelegramBot,
  createTelegramClient
};
