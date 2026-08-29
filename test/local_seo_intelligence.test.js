const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONTROLLED_SERVICE_IDS,
  buildMarketCoverageSnapshot,
  loadCompetitorRegistry
} = require('../tools/market_intelligence');
const {
  KEYWORD_INTENTS,
  SEARCH_SURFACES,
  RESULT_TYPES,
  LocalSeoDataError,
  buildLocalSeoMarketContext,
  buildLocalSeoSnapshot,
  buildSeoObservationCoverage,
  loadKeywordRegistry,
  loadSeoObservations,
  validateKeywordRegistry,
  validateSeoObservations
} = require('../tools/local_seo_intelligence');

const keywordRegistry = {
  version: 1,
  keywords: [
    { id: 'alpha-keyword', query: 'ป้ายหิน ร้อยเอ็ด', intent: 'commercial_local', marketServiceId: 'stone_sign' },
    { id: 'beta-keyword', query: 'แกะสลักหิน ร้อยเอ็ด', intent: 'service_local', marketServiceId: 'stone_engraving' },
    { id: 'unlinked-keyword', query: 'ค้นหาธุรกิจ ร้อยเอ็ด', intent: 'commercial_local' }
  ]
};

const verified = { id: 'verified-a', name: 'Verified A', province: 'Roi Et', verificationStatus: 'verified', sourceUrls: ['https://source.example/a'] };
const pending = { id: 'pending-a', name: 'Pending A', province: 'Roi Et', verificationStatus: 'pending_verification', sourceUrls: [] };
const competitorRegistry = { version: 1, competitors: [verified, pending] };

function observation(overrides = {}) {
  return {
    keywordId: 'alpha-keyword',
    surface: 'google_organic',
    resultType: 'verified_competitor',
    entityName: 'Verified A',
    competitorId: 'verified-a',
    resultUrl: 'https://results.example/a',
    locationLabel: 'Roi Et, Thailand',
    observedAt: '2026-08-29T10:15:00Z',
    ...overrides
  };
}

function observationDocument(observations) {
  return { version: 1, observations };
}

function withoutCompetitorId(value) {
  const copy = { ...value };
  delete copy.competitorId;
  return copy;
}

function assertRejects(value, message) {
  assert.throws(() => value(), LocalSeoDataError, message);
}

test('production keyword registry contains the curated IDs and exact queries', () => {
  const loaded = loadKeywordRegistry();
  const byId = new Map(loaded.keywords.map(keyword => [keyword.id, keyword]));
  for (const expected of [
    ['stone-sign-roi-et', 'ป้ายหิน ร้อยเอ็ด', 'commercial_local', 'stone_sign'],
    ['marble-sign-roi-et', 'ป้ายหินอ่อน ร้อยเอ็ด', 'commercial_local', 'marble_sign'],
    ['granite-sign-roi-et', 'ป้ายหินแกรนิต ร้อยเอ็ด', 'commercial_local', 'granite_sign'],
    ['stone-sign-engraving-roi-et', 'แกะสลักป้ายหิน ร้อยเอ็ด', 'service_local', 'stone_engraving'],
    ['stone-engraving-roi-et', 'แกะสลักหิน ร้อยเอ็ด', 'service_local', 'stone_engraving']
  ]) {
    assert.deepEqual(byId.get(expected[0]), { id: expected[0], query: expected[1], intent: expected[2], marketServiceId: expected[3] });
  }
  assert.equal(byId.has('granite-roi-et'), false);
  assert.equal(loaded.keywords.some(keyword => keyword.query === 'หินแกรนิต ร้อยเอ็ด'), false);
});

test('keyword registry validates controlled fields and fail-closed constraints', () => {
  assert.doesNotThrow(() => validateKeywordRegistry({ version: 1, keywords: [{ id: 'valid', query: 'query', intent: KEYWORD_INTENTS[0] }] }));
  for (const invalid of [
    { version: 2, keywords: [] },
    { version: 1, keywords: [{ id: 'x', query: 'q', intent: 'material_local' }] },
    { version: 1, keywords: [{ id: 'x', query: 'q', intent: KEYWORD_INTENTS[0], searchVolume: 10 }] },
    { version: 1, keywords: [{ id: ' ', query: 'q', intent: KEYWORD_INTENTS[0] }] },
    { version: 1, keywords: [{ id: 'UPPER', query: 'q', intent: KEYWORD_INTENTS[0] }] },
    { version: 1, keywords: [{ id: 'x', query: ' ', intent: KEYWORD_INTENTS[0] }] },
    { version: 1, keywords: [{ id: 'x', query: 'q', intent: KEYWORD_INTENTS[0], marketServiceId: 'unknown' }] },
    { version: 1, keywords: [{ id: 'x', query: 'q', intent: KEYWORD_INTENTS[0] }, { id: 'x', query: 'other', intent: KEYWORD_INTENTS[0] }] },
    { version: 1, keywords: [{ id: 'x', query: 'q', intent: KEYWORD_INTENTS[0] }, { id: 'y', query: 'q', intent: KEYWORD_INTENTS[0] }] }
  ]) assertRejects(() => validateKeywordRegistry(invalid));
});

test('observation enums and valid observation document pass', () => {
  assert.deepEqual(SEARCH_SURFACES, ['google_organic', 'google_local_pack', 'google_maps']);
  assert.deepEqual(RESULT_TYPES, ['own_business', 'verified_competitor', 'unmatched_business']);
  assert.deepEqual(CONTROLLED_SERVICE_IDS, ['stone_sign', 'marble_sign', 'granite_sign', 'granite', 'stone_engraving']);
  assert.doesNotThrow(() => validateSeoObservations(observationDocument([
    observation(),
    withoutCompetitorId(observation({ resultType: 'own_business', entityName: 'Observed OAS', position: 4, sourceUrl: 'https://evidence.example/serp' })),
    withoutCompetitorId(observation({ resultType: 'unmatched_business', entityName: 'Unmatched', position: undefined }))
  ]), keywordRegistry, competitorRegistry));
});

test('observation validation rejects malformed fields, unknown references, pending competitors, and duplicates', () => {
  const invalidObservations = [
    observation({ keywordId: 'unknown' }),
    observation({ surface: 'google_search' }),
    observation({ resultType: 'other' }),
    observation({ entityName: ' ' }),
    observation({ resultUrl: 'not-url' }),
    observation({ resultUrl: 'ftp://example/a' }),
    observation({ locationLabel: '' }),
    observation({ observedAt: 'not-a-date' }),
    observation({ position: 0 }), observation({ position: -1 }), observation({ position: 1.5 }),
    observation({ position: '1' }), observation({ position: null }),
    observation({ sourceUrl: 'ftp://example/evidence' }),
    observation({ competitorId: 'unknown' }), observation({ competitorId: undefined }),
    observation({ competitorId: 'pending-a' }),
    observation({ resultType: 'own_business', competitorId: null }),
    observation({ resultType: 'unmatched_business', competitorId: 'verified-a' }),
    observation({ unexpected: true })
  ];
  for (const invalid of invalidObservations) assertRejects(() => validateSeoObservations(observationDocument([invalid]), keywordRegistry, competitorRegistry));
  const duplicate = observationDocument([observation(), observation({ position: 2 })]);
  assertRejects(() => validateSeoObservations(duplicate, keywordRegistry, competitorRegistry));
  assert.doesNotThrow(() => validateSeoObservations(observationDocument([
    observation({ observedAt: '2026-08-29T10:15:00Z' }), observation({ observedAt: '2026-08-30T10:15:00Z' })
  ]), keywordRegistry, competitorRegistry));
});

test('observation coverage includes zero keywords, sorts, deduplicates, and uses actual timestamps', () => {
  const observations = [
    observation({ keywordId: 'alpha-keyword', surface: 'google_maps', observedAt: '2026-08-29T12:00:00+01:00', position: 5 }),
    observation({ keywordId: 'alpha-keyword', surface: 'google_organic', observedAt: '2026-08-29T11:00:00Z', position: 2 }),
    observation({ keywordId: 'alpha-keyword', surface: 'google_organic', observedAt: '2026-08-29T11:00:00Z', position: 1, entityName: 'Another', resultUrl: 'https://results.example/b' }),
    withoutCompetitorId(observation({ keywordId: 'beta-keyword', resultType: 'unmatched_business', entityName: 'Unmatched', resultUrl: 'https://results.example/u' })),
    withoutCompetitorId(observation({ keywordId: 'beta-keyword', resultType: 'own_business', entityName: 'Own', resultUrl: 'https://results.example/o' })),
    observation({ keywordId: 'beta-keyword', resultType: 'verified_competitor', competitorId: 'verified-a', entityName: 'Verified A', resultUrl: 'https://results.example/c' })
  ];
  const coverage = buildSeoObservationCoverage({ keywordRegistry, observations });
  assert.deepEqual(coverage.map(entry => entry.keywordId), ['alpha-keyword', 'beta-keyword', 'unlinked-keyword']);
  assert.deepEqual(coverage[0].surfacesObserved, ['google_maps', 'google_organic']);
  assert.equal(coverage[0].latestObservedAt, '2026-08-29T12:00:00+01:00');
  assert.deepEqual(coverage[1].verifiedCompetitorIds, ['verified-a']);
  assert.deepEqual(coverage[1].unmatchedBusinessNames, ['Unmatched']);
  assert.equal(coverage[1].ownBusinessObserved, true);
  assert.deepEqual(coverage[2], {
    keywordId: 'unlinked-keyword', query: 'ค้นหาธุรกิจ ร้อยเอ็ด', observationCount: 0,
    surfacesObserved: [], ownBusinessObserved: false, verifiedCompetitorIds: [],
    unmatchedBusinessNames: [], latestObservedAt: null, records: []
  });
  const reversed = buildSeoObservationCoverage({ keywordRegistry, observations: [...observations].reverse() });
  assert.deepEqual(reversed, coverage);
});

test('market handoff maps services without using market snapshot keyword text', () => {
  const marketSnapshot = {
    services: [
      { service: 'stone_sign', label: 'ป้ายหิน', keyword: 'WRONG MARKET QUERY', verifiedCompetitorCount: 1,
        competitors: [{ id: 'verified-a', name: 'Verified A', district: 'เมืองหลัก', sourceUrls: ['https://source.example/a'] }],
        districts: ['เมืองหลัก'], sourceUrls: ['https://source.example/a'] }
    ]
  };
  const context = buildLocalSeoMarketContext({ keywordRegistry, marketSnapshot });
  assert.deepEqual(context[0], {
    keywordId: 'alpha-keyword', query: 'ป้ายหิน ร้อยเอ็ด', marketServiceId: 'stone_sign',
    marketServiceLabel: 'ป้ายหิน', verifiedCompetitorEvidenceCount: 1,
    verifiedCompetitors: [{ id: 'verified-a', name: 'Verified A', district: 'เมืองหลัก', sourceUrls: ['https://source.example/a'] }],
    districts: ['เมืองหลัก'], supportingSourceUrls: ['https://source.example/a']
  });
  assert.equal(context[1].verifiedCompetitorEvidenceCount, 0);
  assert.equal(context[2].marketServiceId, null);
  assert.equal(context[2].marketServiceLabel, null);
  assert.deepEqual(context[2].verifiedCompetitors, []);
  assert.deepEqual(context[2].districts, []);
  assert.deepEqual(context[2].supportingSourceUrls, []);
  assert.doesNotMatch(JSON.stringify(context), /WRONG MARKET QUERY/);
});

test('combined snapshot has observations and market context but no interpretation metrics', () => {
  const marketSnapshot = buildMarketCoverageSnapshot({ version: 1, competitors: [
    { ...verified, serviceEvidence: [{ service: 'stone_sign', sourceUrl: 'https://source.example/a' }] }
  ] });
  const snapshot = buildLocalSeoSnapshot({ keywordRegistry, observations: [], marketSnapshot });
  assert.equal(snapshot.keywords.length, 3);
  assert.deepEqual(snapshot.unobservedKeywordIds, ['alpha-keyword', 'beta-keyword', 'unlinked-keyword']);
  const forbidden = /searchVolume|volume|cpc|difficulty|keywordDifficulty|ranking|rankingScore|competitionScore|opportunity|opportunityScore|priority|recommendation|demand|demandScore/i;
  assert.doesNotMatch(JSON.stringify(snapshot), forbidden);
  assert.doesNotMatch(JSON.stringify(snapshot), /ตลาดนี้ไม่มีคู่แข่ง/);
});

test('configured loaders keep production observations empty and do not create a business profile', () => {
  const observations = loadSeoObservations();
  assert.deepEqual(observations, []);
  assert.equal(require('node:fs').existsSync(require('node:path').join(__dirname, '..', 'data', 'business_profile.json')), false);
});
