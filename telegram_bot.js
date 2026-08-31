const {
  TelegramApiError,
  TelegramConfigError,
  createStaffTelegramBot,
  createTelegramClient,
  parseAllowedChatIds,
  parseCustomerSendEnabled
} = require('./tools/telegram_claire');

const POLL_TIMEOUT_SECONDS = 30;
const RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const client = createTelegramClient({ token: process.env.TELEGRAM_BOT_TOKEN });
  const allowedChatIds = parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
  const customerSendEnabled = parseCustomerSendEnabled(process.env.CUSTOMER_SEND_ENABLED);
  const bot = createStaffTelegramBot({ client, allowedChatIds, customerSendEnabled });
  let stopped = false;

  const stop = () => {
    stopped = true;
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  console.log('OAS Stone Staff Assistant started');
  console.log(`Customer send mode: ${customerSendEnabled ? 'enabled' : 'disabled (DRY RUN)'}`);

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

  console.log('OAS Stone Staff Assistant stopped');
}

if (require.main === module) {
  main().catch(error => {
    if (error instanceof TelegramConfigError) {
      console.error(error.message);
    } else {
      console.error('OAS Stone Staff Assistant failed');
    }
    process.exitCode = 1;
  });
}

module.exports = { main };
