const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'data', 'competitors.json');
const DEFAULT_OBSERVATIONS_PATH = path.join(__dirname, '..', 'data', 'market_observations.json');

class MarketDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MarketDataError';
  }
}

function readJson(filePath, unavailableMessage) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new MarketDataError(unavailableMessage);
  }
}

function validateCompetitorRegistry(registry) {
  if (!registry || registry.version !== 1 || !Array.isArray(registry.competitors)) {
    throw new MarketDataError('competitor registry is invalid');
  }

  const ids = new Set();
  for (const competitor of registry.competitors) {
    if (!competitor || typeof competitor.id !== 'string' || competitor.id.trim() === ''
      || typeof competitor.name !== 'string' || competitor.name.trim() === '') {
      throw new MarketDataError('competitor registry is invalid');
    }
    if (ids.has(competitor.id)) throw new MarketDataError('competitor registry is invalid');
    ids.add(competitor.id);
  }
  return registry;
}

function validateObservation(observation, competitorIds) {
  if (!observation || typeof observation !== 'object') {
    throw new MarketDataError('market observation is invalid');
  }
  for (const field of ['competitorId', 'summary', 'sourceUrl', 'observedAt']) {
    if (typeof observation[field] !== 'string' || observation[field].trim() === '') {
      throw new MarketDataError(`market observation ${field} is required`);
    }
  }
  if (competitorIds && !competitorIds.has(observation.competitorId)) {
    throw new MarketDataError('market observation competitor is unknown');
  }
  try {
    const url = new URL(observation.sourceUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch (error) {
    throw new MarketDataError('market observation sourceUrl is invalid');
  }
  if (Number.isNaN(Date.parse(observation.observedAt))) {
    throw new MarketDataError('market observation observedAt is invalid');
  }
  return observation;
}

function validateObservations(document, registry) {
  if (!document || document.version !== 1 || !Array.isArray(document.observations)) {
    throw new MarketDataError('market observations are invalid');
  }
  const competitorIds = new Set(registry.competitors.map(competitor => competitor.id));
  const seen = new Set();
  for (const observation of document.observations) {
    validateObservation(observation, competitorIds);
    const key = `${observation.competitorId}\u0000${observation.observedAt}\u0000${observation.sourceUrl}\u0000${observation.summary}`;
    if (seen.has(key)) throw new MarketDataError('market observations are invalid');
    seen.add(key);
  }
  return document.observations;
}

function loadCompetitorRegistry(filePath = DEFAULT_REGISTRY_PATH) {
  return validateCompetitorRegistry(readJson(filePath, 'competitor registry unavailable'));
}

function loadObservations(filePath = DEFAULT_OBSERVATIONS_PATH, registry = loadCompetitorRegistry()) {
  return validateObservations(readJson(filePath, 'market observations unavailable'), registry);
}

function sortObservations(observations) {
  return [...observations].sort((left, right) => {
    const byDate = left.observedAt.localeCompare(right.observedAt);
    if (byDate !== 0) return byDate;
    const byCompetitor = left.competitorId.localeCompare(right.competitorId);
    if (byCompetitor !== 0) return byCompetitor;
    const bySource = left.sourceUrl.localeCompare(right.sourceUrl);
    return bySource || left.summary.localeCompare(right.summary);
  });
}

function buildDailyDigest({ registry, observations = [], date = new Date().toISOString().slice(0, 10) } = {}) {
  validateCompetitorRegistry(registry);
  if (!Array.isArray(observations)) throw new MarketDataError('market observations are invalid');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new MarketDataError('market report date is invalid');
  }
  const competitorById = new Map(registry.competitors.map(competitor => [competitor.id, competitor]));
  const competitorIds = new Set(competitorById.keys());
  for (const observation of observations) validateObservation(observation, competitorIds);

  const lines = [`Market Intelligence รายวัน — ${date}`, '', 'Verified observations'];
  if (registry.competitors.length === 0) {
    lines.push('ยังไม่ได้ตั้งค่า competitor registry', 'เพิ่มคู่แข่งที่ยืนยันแล้วก่อนเริ่มติดตาม');
  } else if (observations.length === 0) {
    lines.push('ยังไม่มีข้อมูลที่ตรวจสอบแหล่งอ้างอิงได้');
  } else {
    for (const observation of sortObservations(observations)) {
      const competitor = competitorById.get(observation.competitorId);
      lines.push(
        `- ${competitor.name} (${observation.observedAt})`,
        `  Observation: ${observation.summary}`,
        `  Source: ${observation.sourceUrl}`
      );
    }
  }

  lines.push('', 'Interpretation', 'ไม่มีการตีความอัตโนมัติ ใช้เฉพาะข้อมูลที่มีแหล่งอ้างอิง');
  return lines.join('\n');
}

function buildConfiguredDailyDigest({ registryPath = DEFAULT_REGISTRY_PATH, observationsPath = DEFAULT_OBSERVATIONS_PATH, date } = {}) {
  const registry = loadCompetitorRegistry(registryPath);
  const observations = loadObservations(observationsPath, registry);
  return buildDailyDigest({ registry, observations, date });
}

module.exports = {
  DEFAULT_OBSERVATIONS_PATH,
  DEFAULT_REGISTRY_PATH,
  MarketDataError,
  buildConfiguredDailyDigest,
  buildDailyDigest,
  loadCompetitorRegistry,
  loadObservations,
  validateCompetitorRegistry,
  validateObservation,
  validateObservations
};
