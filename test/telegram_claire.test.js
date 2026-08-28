const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TelegramApiError,
  TelegramConfigError,
  claireReply,
  createClaireTelegramBot,
  createTelegramClient
} = require('../tools/telegram_claire');

test('Telegram client requires a bot token', () => {
  assert.throws(() => createTelegramClient({ token: '' }), TelegramConfigError);
  assert.throws(() => createTelegramClient({}), TelegramConfigError);
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

test('Claire replies to start/help with onboarding text', () => {
  assert.match(claireReply('/start'), /Claire/);
  assert.match(claireReply('/start'), /ขนาด/);
  assert.match(claireReply('/start'), /\/market/);
  assert.equal(claireReply('/help'), claireReply('/start'));
});

test('Claire market command uses injected cited digest', () => {
  const digest = 'รายงานตลาด\nแหล่งข้อมูล: https://example.com';
  assert.equal(claireReply('/market', { marketDigest: () => digest }), digest);
});

test('bot advances offset, replies to text, and ignores non-text messages', async () => {
  const sent = [];
  const calls = [];
  const batches = [
    [
      { update_id: 10, message: { chat: { id: 99 }, text: '/start' } },
      { update_id: 11, message: { chat: { id: 99 }, photo: [{ file_id: 'x' }] } },
      { update_id: 12, edited_message: { chat: { id: 99 }, text: 'ignore' } }
    ],
    []
  ];
  const client = {
    async getUpdates(options) {
      calls.push(options);
      return batches.shift();
    },
    async sendMessage(chatId, text) {
      sent.push({ chatId, text });
    }
  };

  const bot = createClaireTelegramBot({ client });
  const first = await bot.pollOnce({ timeout: 5 });
  const second = await bot.pollOnce({ timeout: 5 });

  assert.deepEqual(first, { processed: 3, nextOffset: 13 });
  assert.deepEqual(second, { processed: 0, nextOffset: 13 });
  assert.deepEqual(calls, [
    { offset: undefined, timeout: 5 },
    { offset: 13, timeout: 5 }
  ]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, 99);
  assert.match(sent[0].text, /Claire/);
});

test('bot routes market command through injected digest', async () => {
  const sent = [];
  const bot = createClaireTelegramBot({
    client: {
      async getUpdates() {
        return [{ update_id: 20, message: { chat: { id: 7 }, text: '/market' } }];
      },
      async sendMessage(chatId, text) {
        sent.push({ chatId, text });
      }
    },
    marketDigest: () => 'market-ok'
  });

  await bot.pollOnce({ timeout: 1 });
  assert.deepEqual(sent, [{ chatId: 7, text: 'market-ok' }]);
});

test('bot rejects malformed getUpdates results', async () => {
  const bot = createClaireTelegramBot({
    client: {
      async getUpdates() { return {}; },
      async sendMessage() {}
    }
  });

  await assert.rejects(() => bot.pollOnce(), TelegramApiError);
});
