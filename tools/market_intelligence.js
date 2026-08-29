const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'data', 'competitors.json');
const DEFAULT_OBSERVATIONS_PATH = path.join(__dirname, '..', 'data', 'market_observations.json');
const CONTROLLED_SERVICE_IDS = Object.freeze([
  'stone_sign',
  'marble_sign',
  'granite_sign',
  'granite',
  'stone_engraving'
]);
const SERVICE_LABELS = Object.freeze({
  stone_sign: 'ป้ายหิน',
  marble_sign: 'ป้ายหินอ่อน',
  granite_sign: 'ป้ายหินแกรนิต',
  granite: 'หินแกรนิต',
  stone_engraving: 'แกะสลักหิน'
});

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

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch (error) {
    return false;
  }
}

function validateCompetitorRegistry(registry) {
  if (!registry || registry.version !== 1 || !Array.isArray(registry.competitors)) {
    throw new MarketDataError('competitor registry is invalid');
  }

  const ids = new Set();
  for (const competitor of registry.competitors) {
    if (!competitor || typeof competitor.id !== 'string' || competitor.id.trim() === ''
      || typeof competitor.name !== 'string' || competitor.name.trim() === ''
      || typeof competitor.province !== 'string' || competitor.province.trim() === ''
      || !['verified', 'pending_verification'].includes(competitor.verificationStatus)) {
      throw new MarketDataError('competitor registry is invalid');
    }
    if (competitor.sourceUrls !== undefined && !Array.isArray(competitor.sourceUrls)) {
      throw new MarketDataError('competitor registry is invalid');
    }
    if (Array.isArray(competitor.sourceUrls)) {
      for (const sourceUrl of competitor.sourceUrls) {
        try {
          const url = new URL(sourceUrl);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
        } catch (error) {
          throw new MarketDataError('competitor registry is invalid');
        }
      }
    }
    if (competitor.verificationStatus === 'verified'
      && (!Array.isArray(competitor.sourceUrls) || competitor.sourceUrls.length === 0)) {
      throw new MarketDataError('verified competitor sourceUrls are required');
    }
    if (competitor.district !== undefined) {
      if (typeof competitor.district !== 'string' || competitor.district.trim() === '') {
        throw new MarketDataError('competitor registry is invalid');
      }
      competitor.district = competitor.district.trim();
    }
    if (competitor.serviceEvidence !== undefined) {
      if (!Array.isArray(competitor.serviceEvidence)
        || (competitor.verificationStatus !== 'verified' && competitor.serviceEvidence.length > 0)) {
        throw new MarketDataError('competitor registry is invalid');
      }
      const sourceUrlSet = new Set(competitor.sourceUrls || []);
      const evidenceKeys = new Set();
      for (const evidence of competitor.serviceEvidence) {
        if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)
          || typeof evidence.service !== 'string' || evidence.service.trim() === ''
          || !CONTROLLED_SERVICE_IDS.includes(evidence.service)
          || typeof evidence.sourceUrl !== 'string' || evidence.sourceUrl.trim() === ''
          || !isHttpUrl(evidence.sourceUrl)
          || !sourceUrlSet.has(evidence.sourceUrl)) {
          throw new MarketDataError('competitor registry is invalid');
        }
        const key = `${evidence.service}\u0000${evidence.sourceUrl}`;
        if (evidenceKeys.has(key)) throw new MarketDataError('competitor registry is invalid');
        evidenceKeys.add(key);
      }
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
  const competitorById = new Map(registry.competitors.map(competitor => [competitor.id, competitor]));
  const competitorIds = new Set(competitorById.keys());
  const seen = new Set();
  for (const observation of document.observations) {
    validateObservation(observation, competitorIds);
    if (competitorById.get(observation.competitorId).verificationStatus !== 'verified') {
      throw new MarketDataError('market observation competitor is pending verification');
    }
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

function verifiedCompetitors(registry) {
  validateCompetitorRegistry(registry);
  return registry.competitors.filter(competitor => competitor.verificationStatus === 'verified');
}

function buildServiceCoverage(registry) {
  const verified = verifiedCompetitors(registry);
  return CONTROLLED_SERVICE_IDS.map(service => {
    const competitors = verified.filter(competitor =>
      (competitor.serviceEvidence || []).some(evidence => evidence.service === service)
    );
    const competitorIds = competitors.map(competitor => competitor.id).sort(compareCodePoints);
    const districts = [...new Set(competitors
      .map(competitor => competitor.district)
      .filter(Boolean))].sort(compareCodePoints);
    return {
      service,
      label: SERVICE_LABELS[service],
      verifiedCompetitorCount: competitorIds.length,
      competitorIds,
      districts
    };
  });
}

function buildDistrictCoverage(registry) {
  const verified = verifiedCompetitors(registry);
  const groups = new Map();
  for (const competitor of verified) {
    const district = competitor.district || null;
    if (!groups.has(district)) groups.set(district, []);
    groups.get(district).push(competitor.id);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === null) return 1;
      if (right === null) return -1;
      return compareCodePoints(left, right);
    })
    .map(([district, ids]) => {
      const competitorIds = [...new Set(ids)].sort(compareCodePoints);
      return { district, verifiedCompetitorCount: competitorIds.length, competitorIds };
    });
}

function buildEvidenceGaps(registry) {
  return buildServiceCoverage(registry)
    .filter(entry => entry.verifiedCompetitorCount === 0)
    .map(entry => ({ service: entry.service, label: entry.label }));
}

function buildMarketCoverageSnapshot(registry) {
  const verified = verifiedCompetitors(registry);
  const services = CONTROLLED_SERVICE_IDS.map(service => {
    const competitors = verified
      .map(competitor => {
        const sourceUrls = [...new Set((competitor.serviceEvidence || [])
          .filter(evidence => evidence.service === service)
          .map(evidence => evidence.sourceUrl))].sort(compareCodePoints);
        if (sourceUrls.length === 0) return null;
        return {
          id: competitor.id,
          name: competitor.name,
          district: competitor.district || null,
          sourceUrls
        };
      })
      .filter(Boolean)
      .sort((left, right) => compareCodePoints(left.id, right.id));
    return {
      service,
      label: SERVICE_LABELS[service],
      keyword: `${SERVICE_LABELS[service]} ร้อยเอ็ด`,
      verifiedCompetitorCount: competitors.length,
      competitors,
      districts: [...new Set(competitors.map(competitor => competitor.district).filter(Boolean))]
        .sort(compareCodePoints),
      sourceUrls: [...new Set(competitors.flatMap(competitor => competitor.sourceUrls))]
        .sort(compareCodePoints)
    };
  });
  return { services };
}

function appendCoverageSections(lines, registry) {
  const services = buildServiceCoverage(registry);
  const districts = buildDistrictCoverage(registry);
  const gaps = buildEvidenceGaps(registry);
  lines.push('', 'Service evidence coverage');
  for (const entry of services) {
    const districtsText = entry.districts.length > 0 ? `; districts: ${entry.districts.join(', ')}` : '';
    lines.push(`- ${entry.label}: ${entry.verifiedCompetitorCount} verified competitors${districtsText}`);
  }
  lines.push('', 'District coverage');
  if (districts.length === 0) {
    lines.push('- ไม่มี verified competitors ที่มีข้อมูล district');
  } else {
    for (const entry of districts) {
      lines.push(`- ${entry.district || 'ไม่ทราบ district'}: ${entry.verifiedCompetitorCount} verified competitors`);
    }
  }
  lines.push('', 'Evidence gaps (ยังไม่มี explicit verified evidence)');
  if (gaps.length === 0) lines.push('- ไม่มี');
  else for (const gap of gaps) lines.push(`- ${gap.label}`);
}

// Daily reports use UTC calendar dates. This keeps an observation's selected
// day deterministic regardless of the machine's local timezone.
function observationReportDate(observedAt) {
  return new Date(observedAt).toISOString().slice(0, 10);
}

function buildDailyDigest({ registry, observations = [], date = new Date().toISOString().slice(0, 10) } = {}) {
  validateCompetitorRegistry(registry);
  if (!Array.isArray(observations)) throw new MarketDataError('market observations are invalid');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new MarketDataError('market report date is invalid');
  }
  const competitorById = new Map(registry.competitors.map(competitor => [competitor.id, competitor]));
  const competitorIds = new Set(competitorById.keys());
  for (const observation of observations) {
    validateObservation(observation, competitorIds);
    if (competitorById.get(observation.competitorId).verificationStatus !== 'verified') {
      throw new MarketDataError('market observation competitor is pending verification');
    }
  }
  const selectedObservations = observations.filter(
    observation => observationReportDate(observation.observedAt) === date
  );

  const lines = [`Market Intelligence รายวัน — ${date}`, '', 'Verified observations'];
  if (registry.competitors.length === 0) {
    lines.push('ยังไม่ได้ตั้งค่า competitor registry', 'เพิ่มคู่แข่งที่ยืนยันแล้วก่อนเริ่มติดตาม');
  } else if (selectedObservations.length === 0) {
    lines.push(`ไม่มีข้อมูลที่ตรวจสอบแหล่งอ้างอิงได้สำหรับวันที่รายงาน ${date}`);
  } else {
    for (const observation of sortObservations(selectedObservations)) {
      const competitor = competitorById.get(observation.competitorId);
      lines.push(
        `- ${competitor.name} (${observation.observedAt})`,
        `  Observation: ${observation.summary}`,
        `  Source: ${observation.sourceUrl}`
      );
    }
  }

  appendCoverageSections(lines, registry);

  const pendingCompetitors = registry.competitors
    .filter(competitor => competitor.verificationStatus === 'pending_verification')
    .sort((left, right) => left.name.localeCompare(right.name));
  if (pendingCompetitors.length > 0) {
    lines.push('', 'Competitors pending verification');
    for (const competitor of pendingCompetitors) lines.push(`- ${competitor.name}`);
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
  buildDistrictCoverage,
  buildEvidenceGaps,
  buildMarketCoverageSnapshot,
  buildServiceCoverage,
  CONTROLLED_SERVICE_IDS,
  loadCompetitorRegistry,
  loadObservations,
  SERVICE_LABELS,
  validateCompetitorRegistry,
  validateObservation,
  validateObservations
};
