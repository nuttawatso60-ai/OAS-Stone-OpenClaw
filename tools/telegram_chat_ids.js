const { TelegramConfigError } = require('./telegram_claire');

function collectChatIds(updates) {
  if (!Array.isArray(updates)) {
    throw new TelegramConfigError('Telegram updates must be an array');
  }

  const seen = new Map();
  for (const update of updates) {
    const chat = update?.message?.chat;
    if (!chat || chat.id === undefined) continue;
    const id = String(chat.id);
    if (!seen.has(id)) {
      seen.set(id, {
        id,
        type: typeof chat.type === 'string' ? chat.type : 'unknown',
        username: typeof chat.username === 'string' ? chat.username : null
      });
    }
  }

  return [...seen.values()];
}

module.exports = { collectChatIds };
