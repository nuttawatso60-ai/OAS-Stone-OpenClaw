const fs = require('node:fs');
const path = require('node:path');
const {
  CONTROLLED_SERVICE_IDS,
  SERVICE_LABELS,
  buildMarketCoverageSnapshot,
  loadCompetitorRegistry
} = require('./market_intelligence');

const DEFAULT_LOCAL_SEO_KEYWORDS_PATH = path.join(__dirname, '..', 'data', 'local_seo_keywords.json');
const DEFAULT_LOCAL_SEO_OBSERVATIONS_PATH = path.join(__dirname, '..', 'data', 'local_seo_observations.json');
const DEFAULT_BUSINESS_PROFILE_PATH = path.join(__dirname, '..', 'data', 'business_profile.json');
const KEYWORD_INTENTS = Object.freeze(['commercial_local', 'service_local']);
const SEARCH_SURFACES = Object.freeze(['google_organic', 'google_local_pack', 'google_maps']);
const RESULT_TYPES = Object.freeze(['own_business', 'verified_competitor', 'unmatched_business']);
const KEYWORD_FIELDS = Object.freeze(['id', 'query', 'intent', 'marketServiceId']);
const OBSERVATION_FIELDS = Object.freeze([
  'keywordId', 'surface', 'resultType', 'entityName', 'competitorId', 'resultUrl',
  'position', 'locationLabel', 'sourceUrl', 'observedAt'
]);
const OWNED_URL_KEYS = Object.freeze(['facebook', 'googleMaps', 'tiktok']);

class LocalSeoDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LocalSeoDataError';
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function rejectUnknownKeys(value, allowed) {
  return Object.keys(value).every(key => allowed.includes(key));
}

function readJson(filePath, unavailableMessage) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new LocalSeoDataError(unavailableMessage);
  }
}

function validateKeywordRegistry(document) {
  if (!isPlainObject(document) || document.version !== 1 || !Array.isArray(document.keywords)) {
    throw new LocalSeoDataError('local SEO keyword registry is invalid');
  }
  const ids = new Set();
  const queries = new Set();
  for (const keyword of document.keywords) {
    if (!isPlainObject(keyword) || !rejectUnknownKeys(keyword, KEYWORD_FIELDS)
      || typeof keyword.id !== 'string' || !/^[a-z0-9-]+$/.test(keyword.id.trim())
      || typeof keyword.query !== 'string' || keyword.query.trim() === ''
      || !KEYWORD_INTENTS.includes(keyword.intent)) {
      throw new LocalSeoDataError('local SEO keyword registry is invalid');
    }
    keyword.id = keyword.id.trim();
    keyword.query = keyword.query.trim();
    if (ids.has(keyword.id) || queries.has(keyword.query)) {
      throw new LocalSeoDataError('local SEO keyword registry is invalid');
    }
    if (keyword.marketServiceId !== undefined
      && (typeof keyword.marketServiceId !== 'string'
        || !CONTROLLED_SERVICE_IDS.includes(keyword.marketServiceId))) {
      throw new LocalSeoDataError('local SEO keyword registry is invalid');
    }
    ids.add(keyword.id);
    queries.add(keyword.query);
  }
  return document;
}

function loadKeywordRegistry(filePath = DEFAULT_LOCAL_SEO_KEYWORDS_PATH) {
  return validateKeywordRegistry(readJson(filePath, 'local SEO keyword registry unavailable'));
}

function validateBusinessProfile(profile) {
  if (!isPlainObject(profile) || profile.version !== 1 || !isPlainObject(profile.ownedUrls)
    || !rejectUnknownKeys(profile, ['version', 'ownedUrls'])
    || !rejectUnknownKeys(profile.ownedUrls, OWNED_URL_KEYS)) {
    throw new LocalSeoDataError('business profile is invalid');
  }
  const entries = Object.entries(profile.ownedUrls);
  if (entries.length === 0 || entries.some(([, value]) => typeof value !== 'string'
    || value.trim() === '' || !isHttpUrl(value))) {
    throw new LocalSeoDataError('business profile is invalid');
  }
  return profile;
}

function loadBusinessProfile(filePath = DEFAULT_BUSINESS_PROFILE_PATH) {
  return validateBusinessProfile(readJson(filePath, 'business profile unavailable'));
}

function normalizedUrl(value) {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url;
}

function isOwnedBusinessUrl(resultUrl, businessProfile) {
  if (typeof resultUrl !== 'string' || !isHttpUrl(resultUrl)) return false;
  try {
    const profile = validateBusinessProfile(businessProfile);
    const rawResult = new URL(resultUrl);
    const result = normalizedUrl(resultUrl);
    const facebook = profile.ownedUrls.facebook;
    if (facebook && (result.hostname === 'facebook.com' || result.hostname === 'www.facebook.com')
      && result.pathname === '/profile.php') {
      const configured = new URL(facebook);
      if (configured.pathname === '/profile.php'
        && rawResult.searchParams.get('id') === configured.searchParams.get('id')
        && rawResult.searchParams.get('id') === '100076982186184') return true;
    }
    const tiktok = profile.ownedUrls.tiktok;
    if (tiktok) {
      const configured = normalizedUrl(tiktok);
      if ((result.hostname === 'tiktok.com' || result.hostname === 'www.tiktok.com')
        && configured.hostname === result.hostname
        && result.pathname === configured.pathname) return true;
    }
    const googleMaps = profile.ownedUrls.googleMaps;
    if (googleMaps && normalizedUrl(googleMaps).toString() === result.toString()) return true;
    return false;
  } catch (error) {
    return false;
  }
}

function validateSeoObservations(document, keywordRegistry, competitorRegistry, businessProfile) {
  validateKeywordRegistry(keywordRegistry);
  if (!isPlainObject(competitorRegistry) || !Array.isArray(competitorRegistry.competitors)) {
    throw new LocalSeoDataError('competitor registry is invalid');
  }
  if (!isPlainObject(document) || document.version !== 1 || !Array.isArray(document.observations)) {
    throw new LocalSeoDataError('local SEO observations are invalid');
  }
  const keywordIds = new Set(keywordRegistry.keywords.map(keyword => keyword.id));
  const competitorById = new Map(competitorRegistry.competitors.map(competitor => [competitor.id, competitor]));
  const seen = new Set();
  for (const observation of document.observations) {
    if (!isPlainObject(observation) || !rejectUnknownKeys(observation, OBSERVATION_FIELDS)
      || typeof observation.keywordId !== 'string' || !keywordIds.has(observation.keywordId)
      || !SEARCH_SURFACES.includes(observation.surface)
      || !RESULT_TYPES.includes(observation.resultType)
      || typeof observation.entityName !== 'string' || observation.entityName.trim() === ''
      || typeof observation.resultUrl !== 'string' || !isHttpUrl(observation.resultUrl)
      || typeof observation.locationLabel !== 'string' || observation.locationLabel.trim() === ''
      || typeof observation.observedAt !== 'string' || Number.isNaN(Date.parse(observation.observedAt))) {
      throw new LocalSeoDataError('local SEO observation is invalid');
    }
    if (observation.position !== undefined
      && (!Number.isSafeInteger(observation.position) || observation.position < 1)) {
      throw new LocalSeoDataError('local SEO observation position is invalid');
    }
    if (observation.sourceUrl !== undefined
      && (typeof observation.sourceUrl !== 'string'
        || observation.sourceUrl.trim() === '' || !isHttpUrl(observation.sourceUrl))) {
      throw new LocalSeoDataError('local SEO observation sourceUrl is invalid');
    }
    if (observation.resultType === 'verified_competitor') {
      const competitor = competitorById.get(observation.competitorId);
      if (typeof observation.competitorId !== 'string' || !competitor
        || competitor.verificationStatus !== 'verified') {
        throw new LocalSeoDataError('local SEO verified competitor is invalid');
      }
    } else if (Object.prototype.hasOwnProperty.call(observation, 'competitorId')) {
      throw new LocalSeoDataError('local SEO non-competitor result cannot have competitorId');
    }
    if (observation.resultType === 'own_business' && businessProfile
      && !isOwnedBusinessUrl(observation.resultUrl, businessProfile)) {
      throw new LocalSeoDataError('local SEO own business URL is not owned');
    }
    const key = [observation.keywordId, observation.surface, observation.observedAt,
      observation.resultUrl, observation.resultType, observation.entityName].join('\u0000');
    if (seen.has(key)) throw new LocalSeoDataError('duplicate local SEO observation');
    seen.add(key);
  }
  return document.observations;
}

function loadSeoObservations(
  filePath = DEFAULT_LOCAL_SEO_OBSERVATIONS_PATH,
  keywordRegistry = loadKeywordRegistry(),
  competitorRegistry = loadCompetitorRegistry()
) {
  return validateSeoObservations(readJson(filePath, 'local SEO observations unavailable'), keywordRegistry, competitorRegistry);
}

function compareObservation(left, right) {
  const byTime = Date.parse(left.observedAt) - Date.parse(right.observedAt);
  if (byTime !== 0) return byTime;
  for (const [a, b] of [[left.keywordId, right.keywordId], [left.surface, right.surface]]) {
    const result = compareCodePoints(a, b);
    if (result !== 0) return result;
  }
  const leftPosition = left.position === undefined ? Number.MAX_SAFE_INTEGER : left.position;
  const rightPosition = right.position === undefined ? Number.MAX_SAFE_INTEGER : right.position;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  for (const [a, b] of [[left.entityName, right.entityName], [left.resultUrl, right.resultUrl], [left.resultType, right.resultType]]) {
    const result = compareCodePoints(a, b);
    if (result !== 0) return result;
  }
  return 0;
}

function buildSeoObservationCoverage({ keywordRegistry, observations, competitorRegistry }) {
  validateKeywordRegistry(keywordRegistry);
  if (!Array.isArray(observations)) throw new LocalSeoDataError('local SEO observations are invalid');
  validateSeoObservations({ version: 1, observations }, keywordRegistry, competitorRegistry);
  return keywordRegistry.keywords.map(keyword => {
    const records = observations.filter(observation => observation.keywordId === keyword.id).sort(compareObservation);
    const timestamps = records.map(record => Date.parse(record.observedAt));
    const latestIndex = timestamps.length === 0 ? -1 : timestamps.reduce((best, time, index) => time > timestamps[best] ? index : best, 0);
    return {
      keywordId: keyword.id,
      query: keyword.query,
      observationCount: records.length,
      surfacesObserved: [...new Set(records.map(record => record.surface))].sort(compareCodePoints),
      ownBusinessObserved: records.some(record => record.resultType === 'own_business'),
      verifiedCompetitorIds: [...new Set(records.filter(record => record.resultType === 'verified_competitor').map(record => record.competitorId))].sort(compareCodePoints),
      unmatchedBusinessNames: [...new Set(records.filter(record => record.resultType === 'unmatched_business').map(record => record.entityName))].sort(compareCodePoints),
      latestObservedAt: latestIndex === -1 ? null : records[latestIndex].observedAt,
      records
    };
  });
}

function buildLocalSeoMarketContext({ keywordRegistry, marketSnapshot }) {
  validateKeywordRegistry(keywordRegistry);
  const services = Array.isArray(marketSnapshot && marketSnapshot.services) ? marketSnapshot.services : [];
  return keywordRegistry.keywords.map(keyword => {
    const service = keyword.marketServiceId === undefined ? null
      : services.find(entry => entry.service === keyword.marketServiceId);
    return {
      keywordId: keyword.id,
      query: keyword.query,
      marketServiceId: keyword.marketServiceId || null,
      marketServiceLabel: service ? service.label : null,
      verifiedCompetitorEvidenceCount: service ? service.verifiedCompetitorCount : 0,
      verifiedCompetitors: service ? service.competitors.map(competitor => ({
        id: competitor.id,
        name: competitor.name,
        district: competitor.district || null,
        sourceUrls: [...competitor.sourceUrls]
      })) : [],
      districts: service ? [...service.districts] : [],
      supportingSourceUrls: service ? [...service.sourceUrls] : []
    };
  });
}

function buildLocalSeoSnapshot({ keywordRegistry, observations, competitorRegistry, marketSnapshot }) {
  const coverage = buildSeoObservationCoverage({ keywordRegistry, observations, competitorRegistry });
  const market = buildLocalSeoMarketContext({ keywordRegistry, marketSnapshot });
  const keywords = keywordRegistry.keywords.map((keyword, index) => ({
    ...keyword,
    marketContext: market[index],
    observationCoverage: coverage[index]
  }));
  return {
    keywords,
    unobservedKeywordIds: coverage.filter(entry => entry.observationCount === 0).map(entry => entry.keywordId)
  };
}

function buildConfiguredLocalSeoSnapshot({ keywordsPath = DEFAULT_LOCAL_SEO_KEYWORDS_PATH, observationsPath = DEFAULT_LOCAL_SEO_OBSERVATIONS_PATH, registryPath } = {}) {
  const keywordRegistry = loadKeywordRegistry(keywordsPath);
  const competitorRegistry = loadCompetitorRegistry(registryPath);
  const observations = loadSeoObservations(observationsPath, keywordRegistry, competitorRegistry);
  const marketSnapshot = buildMarketCoverageSnapshot(competitorRegistry);
  return buildLocalSeoSnapshot({ keywordRegistry, observations, competitorRegistry, marketSnapshot });
}

module.exports = {
  DEFAULT_LOCAL_SEO_KEYWORDS_PATH,
  DEFAULT_LOCAL_SEO_OBSERVATIONS_PATH,
  KEYWORD_INTENTS,
  SEARCH_SURFACES,
  RESULT_TYPES,
  LocalSeoDataError,
  buildConfiguredLocalSeoSnapshot,
  buildLocalSeoMarketContext,
  buildLocalSeoSnapshot,
  buildSeoObservationCoverage,
  loadKeywordRegistry,
  loadSeoObservations,
  DEFAULT_BUSINESS_PROFILE_PATH,
  isOwnedBusinessUrl,
  loadBusinessProfile,
  validateBusinessProfile,
  validateKeywordRegistry,
  validateSeoObservations
};
