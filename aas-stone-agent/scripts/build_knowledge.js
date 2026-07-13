const fs = require('fs');
const path = require('path');
const { readChatFiles } = require('./import_chats');
const { analyzeQuestions, writeQuestions } = require('./analyze_questions');

const ROOT = path.join(__dirname, '..');
const readLines = filename => fs.readFileSync(path.join(ROOT, 'knowledge', filename), 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const writeJson = (filename, value) => fs.writeFileSync(path.join(ROOT, 'generated', filename), JSON.stringify(value, null, 2) + '\n', 'utf8');

function buildKnowledge() {
  const chats = readChatFiles();
  const questions = analyzeQuestions(chats);
  const generatedAt = new Date().toISOString();
  writeQuestions(questions, chats);

  const faqItems = readLines('faq.txt').filter(line => /^\d+\./.test(line)).map(line => ({ question: line.replace(/^\d+\.\s*/, ''), answer: 'ต้องเติมคำตอบที่เจ้าของร้านอนุมัติ' }));
  writeJson('faq_generated.json', { generatedAt, source: 'knowledge/faq.txt', items: faqItems });
  writeJson('response_patterns.json', { generatedAt, source: 'knowledge/response_style.txt', patterns: readLines('response_style.txt').filter(line => line.startsWith('- ')).map(line => line.slice(2)) });
  writeJson('handoff_rules.json', { generatedAt, rules: [
    { when: 'ลูกค้าขอราคา', action: 'ขอรูปตัวอย่างและรายละเอียดงาน แล้วให้พนักงานตรวจสอบ' },
    { when: 'ข้อมูลขนาด วัสดุ หรือจำนวนไม่ครบ', action: 'ถามกลับเพื่อเก็บข้อมูลให้ครบ' },
    { when: 'ลูกค้าถามงานด่วนหรือกำหนดส่ง', action: 'ให้พนักงานตรวจคิวก่อนตอบ' },
    { when: 'คำถามเทคนิคหรือเงื่อนไขนอกฐานความรู้', action: 'ส่งต่อพนักงาน' }
  ] });
  return { chats: chats.length, questions: questions.length, faq: faqItems.length };
}

if (require.main === module) {
  const result = buildKnowledge();
  console.log(`Built knowledge from ${result.chats} chat file(s): ${result.questions} question(s), ${result.faq} FAQ item(s).`);
}

module.exports = { buildKnowledge };
