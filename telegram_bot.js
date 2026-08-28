const {
  TelegramApiError,
  TelegramConfigError,
  createClaireTelegramBot,
  createTelegramClient
} = require('./tools/telegram_claire');

const POLL_TIMEOUT_SECONDS = 30;
const RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const client = createTelegramClient({ token: process.env.TELEGRAM_BOT_TOKEN });
  const bot = createClaireTelegramBot({ client });
  let stopped = false;

  const stop = () => {
    stopped = true;
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  console.log('Claire Telegram bot started');

  while (!stopped) {
    try {
      await bot.pollOnce({ timeout: POLL_TIMEOUT_SECONDS });
    } catch (error) {
      if (error instanceof TelegramApiError) {
        console.error(error.message);
        if (!stopped) await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }

  console.log('Claire Telegram bot stopped');
}

if (require.main === module) {
  main().catch(error => {
    if (error instanceof TelegramConfigError) {
      console.error(error.message);
    } else {
      console.error('Claire Telegram bot failed');
    }
    process.exitCode = 1;
  });
}

module.exports = { main };
