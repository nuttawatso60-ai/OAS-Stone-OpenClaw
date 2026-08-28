const fs = require('node:fs');
const path = require('node:path');
const { getSupportedMaterials } = require('./staff_pricing');

const DEFAULT_KNOWLEDGE_PATH = path.join(__dirname, '..', 'data', 'staff_knowledge.json');

class StaffKnowledgeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StaffKnowledgeError';
  }
}

function loadStaffKnowledge(filePath = DEFAULT_KNOWLEDGE_PATH) {
  let knowledge;
  try {
    knowledge = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new StaffKnowledgeError('staff knowledge data is unavailable');
  }

  if (!knowledge || knowledge.version !== 1 || typeof knowledge.sizes !== 'object'
    || typeof knowledge.training !== 'object' || !Array.isArray(knowledge.quiz)) {
    throw new StaffKnowledgeError('staff knowledge data is invalid');
  }

  const { sizes, training } = knowledge;
  if (typeof sizes.configured !== 'boolean' || typeof sizes.guidance !== 'string'
    || !Array.isArray(sizes.items) || !Array.isArray(training.steps)
    || typeof training.title !== 'string' || typeof training.note !== 'string'
    || training.steps.length === 0 || knowledge.quiz.length === 0) {
    throw new StaffKnowledgeError('staff knowledge data is invalid');
  }

  if (!sizes.configured && sizes.items.length > 0) {
    throw new StaffKnowledgeError('unconfigured sizes must not contain items');
  }

  if (sizes.configured && !sizes.items.every(item => item && typeof item.name === 'string'
    && item.name.trim() !== '' && typeof item.guidance === 'string'
    && item.guidance.trim() !== '')) {
    throw new StaffKnowledgeError('staff knowledge data is invalid');
  }

  if (!training.steps.every(step => typeof step === 'string' && step.trim() !== '')
    || !knowledge.quiz.every(item => item && typeof item.id === 'string'
      && typeof item.question === 'string' && typeof item.answer === 'string')) {
    throw new StaffKnowledgeError('staff knowledge data is invalid');
  }

  return knowledge;
}

function formatMaterials() {
  const lines = ['วัสดุที่รองรับสำหรับ Staff Assistant:'];
  for (const material of getSupportedMaterials()) {
    lines.push(`- ${material.canonical}: ${material.aliases.join(', ')}`);
  }
  lines.push('', 'ไม่แสดง pricing coefficients หรือ rule values ภายใน');
  return lines.join('\n');
}

function formatSizes(knowledge) {
  if (!knowledge.sizes.configured) {
    return [
      'Standard sizes',
      knowledge.sizes.guidance,
      'ให้เก็บความกว้างและความสูงจริงก่อนประเมินราคา'
    ].join('\n');
  }

  const lines = ['Standard sizes'];
  for (const item of knowledge.sizes.items) {
    lines.push(`- ${item.name}: ${item.guidance}`);
  }
  return lines.join('\n');
}

function formatTraining(knowledge) {
  return [
    knowledge.training.title,
    ...knowledge.training.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    knowledge.training.note
  ].join('\n');
}

function formatQuiz(knowledge) {
  return knowledge.quiz.map((item, index) => [
    `คำถาม ${index + 1}: ${item.question}`,
    `เฉลย: ${item.answer}`
  ].join('\n')).join('\n\n');
}

module.exports = {
  DEFAULT_KNOWLEDGE_PATH,
  StaffKnowledgeError,
  formatMaterials,
  formatQuiz,
  formatSizes,
  formatTraining,
  loadStaffKnowledge
};
