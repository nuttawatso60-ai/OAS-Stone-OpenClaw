const fs = require('node:fs');
const path = require('node:path');

class MarketDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MarketDataError';
  }
}

const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'data', 'competitors.json');

function loadCompetitorRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    throw new MarketDataError('competitor registry unavailable');
  }

  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.competitors)) {
    throw new MarketDataError('competitor registry is invalid');
  }

  return parsed;
}

function validateObservation(observation) {
  if (!observation || typeof observation !== 'object') throw new MarketDataError('market observation is invalid');
  for (const field of ['competitorId', 'summary', 'sourceUrl', 'observedAt']) {
    if (typeof observation[field] !== 'string' || observation[field].trim() === '') {
      throw new MarketDataError(`market observation ${field} is required`);
    }
  }
  try {
    new URL(observation.sourceUrl);
  } catch (error) {
    throw new MarketDataError('market observation sourceUrl is invalid');
  }
  if (Number.isNaN(Date.parse(observation.observedAt))) {
    throw new MarketDataError('market observation observedAt is invalid');
  }
}

function buildDailyDigest({ registry, observations = [], date = new Date().toISOString().slice(0, 10) } = {}) {
  if (!registry || !Array.isArray(registry.competitors)) throw new MarketDataError('competitor registry is required');
  const competitorById = new Map(registry.competitors.map(item => [item.id, item]));
  const valid = [];
  for (const observation of observations) {
    validateObservation(observation);
    if (!competitorById.has(observation.competitorId)) continue;
    valid.push(observation);
  }

  const lines = [`รายงานตลาดประจำวัน — ${date}`];
  if (registry.competitors.length === 0) {
    lines.push('', 'ยังไม่ได้เพิ่มคู่แข่งในระบบ', 'เพิ่มรายชื่อและแหล่งข้อมูลใน data/competitors.json ก่อนเริ่มติดตาม');
    return lines.join('\n');
  }
  if (valid.length === 0) {
    lines.push('', `กำลังติดตาม ${registry.competitors.length} ราย`, 'วันนี้ยังไม่มีข้อมูลที่ตรวจสอบแหล่งอ้างอิงได้');
    return lines.join('\n');
  }

  for (const observation of valid) {
    const competitor = competitorById.get(observation.competitorId);
    lines.push('', `• ${competitor.name}`, `  ${observation.summary}`, `  แหล่งข้อมูล: ${observation.sourceUrl}`);
  }
  lines.push('', 'หมายเหตุ: รายงานนี้สรุปเฉพาะข้อมูลที่มีแหล่งอ้างอิง ระบบจะไม่เติมข้อมูลที่ไม่มีหลักฐาน');
  return lines.join('\n');
}

module.exports = {
  MarketDataError,
  buildDailyDigest,
  loadCompetitorRegistry,
  validateObservation
};
