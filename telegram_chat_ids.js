const { createTelegramClient, TelegramApiError, TelegramConfigError } = require('./tools/telegram_claire');
const { collectChatIds } = require('./tools/telegram_chat_ids');

async function main() {
  const client = createTelegramClient({ token: process.env.TELEGRAM_BOT_TOKEN });
  const updates = await client.getUpdates({ timeout: 0 });
  const chats = collectChatIds(updates);

  if (chats.length === 0) {
    console.log('No recent Telegram chats found. Send /start to the Staff Assistant, then run this command again.');
    return;
  }

  console.table(chats);
}

if (require.main === module) {
  main().catch(error => {
    if (error instanceof TelegramConfigError || error instanceof TelegramApiError) {
      console.error(error.message);
    } else {
      console.error('Telegram chat ID lookup failed');
    }
    process.exitCode = 1;
  });
}

module.exports = { main };
