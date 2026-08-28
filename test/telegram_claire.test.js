const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TelegramApiError,
  TelegramConfigError,
  claireReply,
  createClaireTelegramBot,
  createTelegramClient,
  parseAllowedChatIds
} = require('../tools/telegram_claire');

test('Telegram client requires a bot token', () => {
  assert.throws(() => createTelegramClient({ token: '' }), TelegramConfigError);
  assert.throws(() => createTelegramClient({}), TelegramConfigError);
});

test('Telegram allowed chat IDs fail closed when missing or malformed', () => {
  assert.throws(() => parseAllowedChatIds(''), TelegramConfigError);
  assert.throws(() => parseAllowedChatIds(), TelegramConfigError);
  assert.throws(() => parseAllowedChatIds('123,abc'), TelegramConfigError);
  assert.deepEqual([...parseAllowedChatIds('123, -456,123')].sort(), ['-456', '123']);
});

test('Telegram client sends JSON requests and returns result', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { ok: true, result: [{ update_id: 7 }] };
      }
    };
  };

  const client = createTelegramClient({ token: '123:test-token', fetchImpl });
  const result = await client.getUpdates({ offset: 4, timeout: 12 });

  assert.deepEqual(result, [{ update_id: 7 }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.telegram.org/bot123:test-token/getUpdates');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    offset: 4,
    timeout: 12,
    allowed_updates: ['message']
  });
});

test('Telegram errors do not expose token or upstream description', async () => {
  const token = '123:super-secret';
  const client = createTelegramClient({
    token,
    fetchImpl: async () => ({
      ok: false,
      async json() {
        return { ok: false, description: `bad token ${token}` };
      }
    })
  });

  await assert.rejects(
    () => client.getUpdates(),
    error => error instanceof TelegramApiError
      && !error.message.includes(token)
      && !error.message.includes('bad token')
  );
});

test('staff assistant replies to start/help with internal-tool text', () => {
  assert.match(claireReply('/start'), /Staff Assistant/);
  assert.match(claireReply('/start'), /ภายใน/);
  assert.equal(claireReply('/help'), claireReply('/start'));
});

test('bot replies only to allowed chats and stays silent for outsiders', async () => {
  const sent = [];
  const batches = [[
    { update_id: 10, message: { chat: { id: 99 }, text: '/start' } },
    { update_id: 11, message: { chat: { id: 100 }, text: '/start' } },
    { update_id: 12, message: { chat: { id: 99 }, photo: [{ file_id: 'x' }] } }
  ]];
  const client = {
    async getUpdates() { return batches.shift(); },
    async sendMessage(chatId, text) { sent.push({ chatId, text }); }
  };

  const bot = createClaireTelegramBot({ client, allowedChatIds: new Set(['99']) });
  const result = await bot.pollOnce({ timeout: 5 });

  assert.deepEqual(result, { processed: 3, nextOffset: 13 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, 99);
  assert.match(sent[0].text, /Staff Assistant/);
});

test('bot requires a non-empty allowlist', () => {
  const client = { async getUpdates() { return []; }, async sendMessage() {} };
  assert.throws(() => createClaireTelegramBot({ client }), TelegramConfigError);
  assert.throws(() => createClaireTelegramBot({ client, allowedChatIds: new Set() }), TelegramConfigError);
});

test('bot rejects malformed getUpdates results', async () => {
  const bot = createClaireTelegramBot({
    allowedChatIds: new Set(['99']),
    client: {
      async getUpdates() { return {}; },
      async sendMessage() {}
    }
  });

  await assert.rejects(() => bot.pollOnce(), TelegramApiError);
});
