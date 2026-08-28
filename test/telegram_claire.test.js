const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TelegramApiError,
  TelegramConfigError,
  claireReply,
  createClaireTelegramBot,
  createStaffTelegramBot,
  createTelegramClient,
  parseAllowedChatIds,
  staffReply
} = require('../tools/telegram_claire');
const { collectChatIds } = require('../tools/telegram_chat_ids');

test('Telegram client requires a bot token', () => {
  assert.throws(() => createTelegramClient({ token: '' }), TelegramConfigError);
  assert.throws(() => createTelegramClient({}), TelegramConfigError);
});

test('Telegram allowed chat IDs fail closed when missing or malformed', () => {
  assert.throws(() => parseAllowedChatIds(''), TelegramConfigError);
  assert.throws(() => parseAllowedChatIds(), TelegramConfigError);
  assert.throws(() => parseAllowedChatIds('123,abc'), TelegramConfigError);
  assert.throws(() => parseAllowedChatIds('123,,456'), TelegramConfigError);
  assert.throws(() => parseAllowedChatIds('123.0'), TelegramConfigError);
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

test('canonical Staff Assistant API returns internal wording', () => {
  assert.equal(createStaffTelegramBot, createClaireTelegramBot);
  assert.match(claireReply('/help'), /Staff Assistant/);
  assert.doesNotMatch(claireReply('/help'), /customer intake/i);
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

test('unauthorized chats produce no outbound request', async () => {
  const sent = [];
  const client = {
    async getUpdates() {
      return [{ update_id: 1, message: { chat: { id: 1000 }, text: '/price granite 30x20' } }];
    },
    async sendMessage(...args) { sent.push(args); }
  };

  const bot = createStaffTelegramBot({ client, allowedChatIds: new Set(['99']) });
  await bot.pollOnce();
  assert.deepEqual(sent, []);
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

test('chat ID discovery returns metadata without message contents', () => {
  const token = '123:secret-token';
  const chats = collectChatIds([
    { update_id: 1, message: { chat: { id: 99, type: 'private', username: 'staff' }, text: token } },
    { update_id: 2, message: { chat: { id: 99, type: 'private', username: 'staff' }, text: 'private message' } },
    { update_id: 3, message: { chat: { id: -1001, type: 'supergroup' }, caption: 'private caption' } }
  ]);

  assert.deepEqual(chats, [
    { id: '99', type: 'private' },
    { id: '-1001', type: 'supergroup' }
  ]);
  assert.equal(JSON.stringify(chats).includes(token), false);
  assert.equal(JSON.stringify(chats).includes('private message'), false);
});

test('staff reply dispatches group command forms with the bot username suffix', () => {
  assert.equal(staffReply('/start@oas_stone_shop_bot'), staffReply('/start'));
  assert.equal(staffReply('/help@oas_stone_shop_bot'), staffReply('/help'));
  assert.equal(
    staffReply('/price@oas_stone_shop_bot granite 30x20'),
    staffReply('/price granite 30x20')
  );
  assert.match(staffReply('/price@oas_stone_shop_bot granite 30x20'), /รวมประมาณ:/);
});

test('staff reply never renders Infinity for oversized quantities', () => {
  const reply = staffReply('/price granite 30x20 1e308');
  assert.equal(reply.includes('∞'), false);
  assert.equal(reply.includes('Infinity'), false);
  assert.match(reply, /จำนวนต้องเป็นเลขจำนวนเต็มบวก/);
});

test('staff knowledge commands return deterministic internal content', () => {
  const materials = staffReply('/materials');
  assert.match(materials, /granite/);
  assert.match(materials, /แกรนิต/);
  assert.doesNotMatch(materials, /base_per_cm2|cnc_rate_per_minute/);
  assert.match(staffReply('/sizes'), /ยังไม่ได้กำหนด standard sizes/);
  assert.match(staffReply('/train'), /วัสดุ/);
  assert.match(staffReply('/quiz'), /คำถาม 1:/);
  assert.doesNotMatch(staffReply('/quiz'), /base_per_cm2|cnc_rate_per_minute/);
});

test('staff knowledge commands support Telegram group suffixes', () => {
  for (const command of ['/materials', '/sizes', '/train', '/quiz']) {
    assert.equal(
      staffReply(`${command}@oas_stone_shop_bot`),
      staffReply(command)
    );
  }
});

test('market command is internal, deterministic, and supports group suffixes', () => {
  const market = staffReply('/market');
  assert.equal(staffReply('/market@oas_stone_shop_bot'), market);
  assert.match(market, /Verified observations/);
  assert.match(market, /ยังไม่ได้ตั้งค่า competitor registry/);
  assert.doesNotMatch(market, /base_per_cm2|cnc_rate_per_minute/);
});

test('unknown commands fall through without echoing the input back', () => {
  const secret = 'staff-only-8985228277';
  for (const text of [`/unknown ${secret}`, secret, '/pricey granite 30x20']) {
    const reply = staffReply(text);
    assert.equal(reply.includes(secret), false, `reply echoed input for ${text}`);
    assert.match(reply, /ใช้ \/help/);
  }
});
