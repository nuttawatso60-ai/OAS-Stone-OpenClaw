const test = require('node:test');
const assert = require('node:assert/strict');

const telegramModule = require('../tools/telegram_claire');
const {
  TelegramApiError,
  TelegramConfigError,
  claireReply,
  createClaireTelegramBot,
  createStaffTelegramBot,
  createTelegramClient,
  parseAllowedChatIds,
  staffReply
} = telegramModule;
const { collectChatIds } = require('../tools/telegram_chat_ids');

// Telegram is an internal market/competitor intelligence surface only. Pricing,
// customer-response drafting, target binding, approval, and outbound customer
// sending are deliberately not part of this runtime.
const REMOVED_COMMANDS = ['/price', '/draft', '/target', '/approve', '/sendstatus'];

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

test('start/help lists only supported market intelligence commands', () => {
  const help = staffReply('/help');
  assert.equal(claireReply('/start'), help);
  assert.match(help, /Market Intelligence/);
  assert.match(help, /ภายใน/);
  assert.match(help, /\/market/);
  for (const command of REMOVED_COMMANDS) {
    assert.equal(help.includes(command), false, `help still advertises ${command}`);
  }
  for (const command of ['/materials', '/sizes', '/train', '/quiz']) {
    assert.equal(help.includes(command), false, `help still advertises ${command}`);
  }
  assert.doesNotMatch(help, /customer intake/i);
});

test('canonical Staff Assistant API aliases still resolve', () => {
  assert.equal(createStaffTelegramBot, createClaireTelegramBot);
  assert.equal(claireReply, staffReply);
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
  assert.match(sent[0].text, /Market Intelligence/);
});

test('unauthorized chats produce no outbound request', async () => {
  const sent = [];
  const client = {
    async getUpdates() {
      return [
        { update_id: 1, message: { chat: { id: 1000 }, text: '/market' } },
        { update_id: 2, message: { chat: { id: 1000 }, text: '/price granite 30x20' } }
      ];
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

test('market command is internal, deterministic, and supports group suffixes', () => {
  const market = staffReply('/market');
  assert.equal(staffReply('/market@oas_stone_shop_bot'), market);
  assert.match(market, /Market Intelligence รายวัน — \d{4}-\d{2}-\d{2}/);
  assert.match(market, /Verified observations/);
  assert.match(market, /Service evidence coverage/);
  assert.match(market, /District coverage/);
  assert.match(market, /Evidence gaps \(ยังไม่มี explicit verified evidence\)/);
  assert.match(market, /Competitors pending verification/);
  assert.match(market, /Interpretation/);
  assert.doesNotMatch(market, /base_per_cm2|cnc_rate_per_minute/);
});

test('help dispatches group command forms with the bot username suffix', () => {
  assert.equal(staffReply('/start@oas_stone_shop_bot'), staffReply('/start'));
  assert.equal(staffReply('/help@oas_stone_shop_bot'), staffReply('/help'));
});

test('removed pricing and customer-workflow commands are no longer routed', () => {
  const fallback = staffReply('/definitely-not-a-command');
  const invocations = [
    '/price granite 30x20',
    '/price granite 30x20 2',
    '/draft stone_sign granite 40x60 1',
    '/target draft_0000000000000000 -100123',
    '/approve draft_0000000000000000',
    '/sendstatus'
  ];
  for (const text of invocations) {
    const reply = staffReply(text);
    assert.equal(reply, fallback, `${text} is still routed to a dedicated handler`);
    assert.equal(reply, staffReply(`${text.split(' ')[0]}@oas_stone_shop_bot ${text.split(' ').slice(1).join(' ')}`.trim()));
  }
});

test('removed pricing and customer-workflow replies leak no pricing or send output', () => {
  for (const text of ['/price granite 30x20', '/draft stone_sign granite 40x60 1', '/sendstatus']) {
    const reply = staffReply(text);
    assert.doesNotMatch(reply, /รวมประมาณ|บาท|THB|Draft ID|Target bound|DRY RUN|dry_run|Pending drafts/i);
  }
});

test('staff knowledge commands are no longer part of the Telegram surface', () => {
  const fallback = staffReply('/definitely-not-a-command');
  for (const command of ['/materials', '/sizes', '/train', '/quiz']) {
    assert.equal(staffReply(command), fallback, `${command} is still routed`);
  }
});

test('Telegram runtime exposes no customer send primitive or send flag', () => {
  for (const removed of [
    'sendCustomerTelegramMessage',
    'parseCustomerSendEnabled',
    'staffReplyAsync',
    'parseDraftCommand',
    'parseTargetCommand',
    'formatCustomerMessage',
    'formatCustomerResponseDraft',
    'buildCustomerResponseDraft'
  ]) {
    assert.equal(telegramModule[removed], undefined, `telegram_claire still exports ${removed}`);
  }
  const client = createTelegramClient({ token: '123:t', fetchImpl: async () => ({ ok: true, async json() { return { ok: true, result: [] }; } }) });
  assert.deepEqual(Object.keys(client).sort(), ['getUpdates', 'sendMessage']);
});

test('CUSTOMER_SEND_ENABLED=true has no effect because no customer path exists', async () => {
  const previous = process.env.CUSTOMER_SEND_ENABLED;
  process.env.CUSTOMER_SEND_ENABLED = 'true';
  try {
    const sent = [];
    const bot = createStaffTelegramBot({
      allowedChatIds: new Set(['99']),
      client: {
        async getUpdates() {
          return [
            { update_id: 1, message: { chat: { id: 99 }, text: '/approve draft_0000000000000000' } },
            { update_id: 2, message: { chat: { id: 99 }, text: '/sendstatus' } },
            { update_id: 3, message: { chat: { id: 99 }, text: '/draft stone_sign granite 40x60 1' } }
          ];
        },
        async sendMessage(chatId, text) { sent.push({ chatId, text }); }
      }
    });
    await bot.pollOnce();
    // Every reply goes back to the originating allowlisted staff chat only.
    assert.equal(sent.length, 3);
    for (const message of sent) {
      assert.equal(message.chatId, 99);
      assert.match(message.text, /ใช้ \/help/);
      assert.doesNotMatch(message.text, /enabled|DRY RUN|Draft ID|Target/i);
    }
  } finally {
    if (previous === undefined) delete process.env.CUSTOMER_SEND_ENABLED;
    else process.env.CUSTOMER_SEND_ENABLED = previous;
  }
});

test('unknown commands fall through without echoing the input back', () => {
  const secret = 'staff-only-8985228277';
  for (const text of [`/unknown ${secret}`, secret, '/pricey granite 30x20']) {
    const reply = staffReply(text);
    assert.equal(reply.includes(secret), false, `reply echoed input for ${text}`);
    assert.match(reply, /ใช้ \/help/);
  }
});
