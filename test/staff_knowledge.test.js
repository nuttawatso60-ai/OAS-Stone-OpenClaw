const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  StaffKnowledgeError,
  formatMaterials,
  formatQuiz,
  formatSizes,
  formatTraining,
  loadStaffKnowledge
} = require('../tools/staff_knowledge');

function writeTempKnowledge(value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-knowledge-'));
  const filePath = path.join(dir, 'knowledge.json');
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
  return filePath;
}

test('loads version-controlled knowledge with safe unconfigured sizes', () => {
  const knowledge = loadStaffKnowledge();
  assert.equal(knowledge.version, 1);
  assert.equal(knowledge.sizes.configured, false);
  assert.equal(knowledge.sizes.items.length, 0);
  assert.match(formatMaterials(), /granite/);
  assert.match(formatSizes(knowledge), /ยังไม่ได้กำหนด standard sizes/);
  assert.match(formatTraining(knowledge), /จำนวน/);
  assert.match(formatQuiz(knowledge), /depth 3 mm/);
});

test('missing or malformed knowledge data fails safely', () => {
  assert.throws(() => loadStaffKnowledge('missing-staff-knowledge.json'), StaffKnowledgeError);
  const base = loadStaffKnowledge();
  assert.throws(() => loadStaffKnowledge(writeTempKnowledge({})), StaffKnowledgeError);
  assert.throws(() => loadStaffKnowledge(writeTempKnowledge({
    ...base,
    sizes: { ...base.sizes, configured: false, items: [{ name: 'invented', guidance: 'x' }] }
  })), StaffKnowledgeError);
  assert.throws(() => loadStaffKnowledge(writeTempKnowledge({
    ...base,
    sizes: { ...base.sizes, configured: true, items: [{ name: 'missing guidance' }] }
  })), StaffKnowledgeError);
});

test('knowledge renderers do not expose pricing coefficients', () => {
  const knowledge = loadStaffKnowledge();
  const text = [formatMaterials(), formatSizes(knowledge), formatTraining(knowledge), formatQuiz(knowledge)].join('\n');
  assert.doesNotMatch(text, /base_per_cm2|minutes_per_cm2|cnc_rate_per_minute|minimum_price/);
});
