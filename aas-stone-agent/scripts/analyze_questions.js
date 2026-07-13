const fs = require('fs');
const path = require('path');
const { readChatFiles } = require('./import_chats');

const GENERATED_FILE = path.join(__dirname, '..', 'generated', 'customer_questions.json');
const QUESTION_WORDS = ['ไหม', 'หรือไม่', 'เท่าไหร่', 'กี่', 'ยังไง', 'อย่างไร', 'รับทำ', 'ราคา', 'มี', 'ได้ไหม'];

function normalizeQuestion(text) {
  return text.replace(/\s+/g, ' ').replace(/[?？]+$/g, '').trim().toLowerCase();
}

function isQuestion(line) {
  const text = line.trim();
  return /[?？]$/.test(text) || QUESTION_WORDS.some(word => text.includes(word));
}

function analyzeQuestions(chats = readChatFiles()) {
  const counts = new Map();
  for (const chat of chats) {
    for (const line of chat.text.split(/\r?\n/)) {
      if (!isQuestion(line)) continue;
      const normalized = normalizeQuestion(line);
      if (normalized.length < 2) continue;
      const item = counts.get(normalized) || { question: line.trim(), count: 0, sources: [] };
      item.count += 1;
      if (!item.sources.includes(chat.file)) item.sources.push(chat.file);
      counts.set(normalized, item);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.question.localeCompare(b.question, 'th'));
}

function writeQuestions(questions, chats) {
  fs.mkdirSync(path.dirname(GENERATED_FILE), { recursive: true });
  fs.writeFileSync(GENERATED_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceFiles: chats.map(chat => chat.file),
    questions
  }, null, 2) + '\n', 'utf8');
}

if (require.main === module) {
  const chats = readChatFiles();
  const questions = analyzeQuestions(chats);
  writeQuestions(questions, chats);
  console.log(`Analyzed ${chats.length} chat file(s), found ${questions.length} unique question(s).`);
}

module.exports = { analyzeQuestions, writeQuestions };
