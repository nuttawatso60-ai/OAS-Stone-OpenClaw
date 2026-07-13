const fs = require('fs');
const path = require('path');

const CHAT_HISTORY_DIR = path.join(__dirname, '..', 'chat_history');

function walkTxtFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkTxtFiles(fullPath);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.txt') ? [fullPath] : [];
  });
}

function readChatFiles(directory = CHAT_HISTORY_DIR) {
  return walkTxtFiles(directory).map(filePath => ({
    file: path.relative(path.join(__dirname, '..'), filePath).replace(/\\/g, '/'),
    text: fs.readFileSync(filePath, 'utf8')
  }));
}

if (require.main === module) {
  const chats = readChatFiles();
  console.log(JSON.stringify({ files: chats.length, chats }, null, 2));
}

module.exports = { readChatFiles };
