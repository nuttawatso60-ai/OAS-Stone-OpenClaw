const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  MarketDataError,
  buildConfiguredDailyDigest,
  buildDailyDigest,
  loadCompetitorRegistry,
  loadObservations,
  validateObservation
} = require('../tools/market_intelligence');

function tempJson(value) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'market-intelligence-'));
  const filePath = path.join(directory, 'data.json');
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
  return filePath;
}

function verifiedCompetitor(id = 'stone-a', name = 'Stone A') {
  return {
    id,
    name,
    province: 'Roi Et',
    verificationStatus: 'verified',
    sourceUrls: ['https://example.com/business']
  };
}

function pendingCompetitor(id = 'stone-p', name = 'Stone Pending') {
  return {
    id,
    name,
    province: 'Roi Et',
    verificationStatus: 'pending_verification',
    sourceUrls: []
  };
}

test('empty registry returns setup guidance without fabricated content', () => {
  const registryPath = tempJson({ version: 1, competitors: [] });
  const observationsPath = tempJson({ version: 1, observations: [] });
  const digest = buildConfiguredDailyDigest({ registryPath, observationsPath, date: '2026-08-28' });
  assert.match(digest, /ยังไม่ได้ตั้งค่า competitor registry/);
  assert.match(digest, /Verified observations/);
  assert.match(digest, /Interpretation/);
});

test('malformed registry and observations fail safely', () => {
  assert.throws(() => loadCompetitorRegistry(tempJson({ version: 2, competitors: [] })), MarketDataError);
  const registry = { version: 1, competitors: [verifiedCompetitor()] };
  assert.throws(() => loadObservations(tempJson({ version: 1, observations: [{ competitorId: 'stone-a' }] }), registry), MarketDataError);
  assert.throws(() => loadObservations(tempJson({ version: 1, observations: [{ competitorId: 'stone-a', summary: 'x', sourceUrl: 'ftp://example.com', observedAt: '2026-08-28T00:00:00Z' }] }), registry), MarketDataError);
});

test('unknown competitor IDs, missing URLs, and invalid timestamps fail closed', () => {
  const registry = { version: 1, competitors: [verifiedCompetitor()] };
  assert.throws(() => buildDailyDigest({ registry, observations: [{ competitorId: 'unknown', summary: 'x', sourceUrl: 'https://example.com', observedAt: '2026-08-28T00:00:00Z' }] }), MarketDataError);
  assert.throws(() => validateObservation({ competitorId: 'stone-a', summary: 'x', observedAt: '2026-08-28T00:00:00Z' }), MarketDataError);
  assert.throws(() => validateObservation({ competitorId: 'stone-a', summary: 'x', sourceUrl: 'https://example.com', observedAt: 'not-a-date' }), MarketDataError);
});

test('verification status and verified source requirements fail closed', () => {
  assert.throws(() => loadCompetitorRegistry(tempJson({
    version: 1,
    competitors: [{ ...pendingCompetitor(), verificationStatus: 'maybe' }]
  })), MarketDataError);
  assert.throws(() => loadCompetitorRegistry(tempJson({
    version: 1,
    competitors: [{ ...verifiedCompetitor(), sourceUrls: [] }]
  })), MarketDataError);
  assert.doesNotThrow(() => loadCompetitorRegistry(tempJson({ version: 1, competitors: [pendingCompetitor()] })));
});

test('pending competitors are listed by name but cannot produce verified observations', () => {
  const registry = { version: 1, competitors: [verifiedCompetitor(), pendingCompetitor()] };
  const digest = buildDailyDigest({ registry, observations: [], date: '2026-08-28' });
  assert.match(digest, /Competitors pending verification[\s\S]*Stone Pending/);
  const verifiedSection = digest.split('\n\nCompetitors pending verification')[0];
  assert.doesNotMatch(verifiedSection, /Stone Pending/);
  assert.throws(() => buildDailyDigest({
    registry,
    observations: [{ competitorId: 'stone-p', summary: 'unsupported claim', sourceUrl: 'https://example.com/pending', observedAt: '2026-08-28T00:00:00Z' }],
    date: '2026-08-28'
  }), MarketDataError);
});

test('Roi Et registry keeps only sufficiently evidenced competitors verified', () => {
  const registry = loadCompetitorRegistry();
  const competitorsById = new Map(registry.competitors.map(competitor => [competitor.id, competitor]));
  const knownRoiEtIds = [
    'baan-tham-pai',
    'phlanchai-pai-hin',
    'chinna-kae-salak-pai-hin',
    'ran-fa-tak',
    'ran-phong-granite',
    'pai-hin-kae-salak-kasetwisai',
    'wannasut-art-and-com'
  ];
  for (const id of knownRoiEtIds) {
    assert.ok(competitorsById.has(id), `missing known competitor: ${id}`);
    assert.equal(competitorsById.get(id).province, 'Roi Et');
  }

  for (const id of [
    'phlanchai-pai-hin',
    'ran-fa-tak',
    'pai-hin-kae-salak-kasetwisai',
    'wannasut-art-and-com'
  ]) {
    assert.equal(competitorsById.get(id).verificationStatus, 'verified');
    assert.ok(competitorsById.get(id).sourceUrls.length > 0);
  }
  assert.equal(competitorsById.get('baan-tham-pai').name, 'ร้านบ้านทำป้ายแกะสลัก');
  assert.equal(competitorsById.get('baan-tham-pai').verificationStatus, 'verified');
  assert.deepEqual(competitorsById.get('baan-tham-pai').sourceUrls, [
    'https://www.google.com/maps?cid=15093723125795807870'
  ]);
  assert.equal(competitorsById.get('pai-hin-kae-salak-kasetwisai').name, 'ป้ายหินแกะสลัก');
  assert.deepEqual(competitorsById.get('pai-hin-kae-salak-kasetwisai').sourceUrls, [
    'https://www.google.com/maps/search/?api=1&query=MH4P%2BGRV%2C%20Kaset%20Wisai%2C%20Roi%20Et%2C%20Thailand&query_place_id=ChIJqwW3GwCLFzERhWbYlIWQjiI'
  ]);
  assert.equal(competitorsById.get('wannasut-art-and-com').name, 'วรรณสุทธิ์ อาร์ต แอนด์ คอม');
  assert.deepEqual(competitorsById.get('wannasut-art-and-com').sourceUrls, [
    'https://www.yellowpages.co.th/profile/%E0%B8%A7%E0%B8%A3%E0%B8%A3%E0%B8%93%E0%B8%AA%E0%B8%B8%E0%B8%97%E0%B8%98%E0%B8%B4%E0%B9%8C-%E0%B8%AD%E0%B8%B2%E0%B8%A3%E0%B9%8C%E0%B8%95-%E0%B9%81%E0%B8%AD%E0%B8%99%E0%B8%94%E0%B9%8C-%E0%B8%84%E0%B8%AD%E0%B8%A1-93T3PT9QA'
  ]);
  for (const sourceUrl of competitorsById.get('phlanchai-pai-hin').sourceUrls
    .concat(competitorsById.get('ran-fa-tak').sourceUrls)
    .concat(competitorsById.get('baan-tham-pai').sourceUrls)
    .concat(competitorsById.get('pai-hin-kae-salak-kasetwisai').sourceUrls)
    .concat(competitorsById.get('wannasut-art-and-com').sourceUrls)) {
    assert.ok(['http:', 'https:'].includes(new URL(sourceUrl).protocol));
  }

  for (const id of ['chinna-kae-salak-pai-hin', 'ran-phong-granite']) {
    assert.equal(competitorsById.get(id).verificationStatus, 'pending_verification');
    assert.deepEqual(competitorsById.get(id).sourceUrls, []);
  }
  assert.equal(competitorsById.get('ran-phong-granite').name, 'ร้านผ่องแกรนิต');

  const observations = loadObservations();
  for (const observation of observations) {
    const competitor = competitorsById.get(observation.competitorId);
    assert.ok(competitor, `observation references unknown competitor: ${observation.competitorId}`);
    assert.equal(competitor.verificationStatus, 'verified');
  }
  const baanThamPaiObservation = observations.find(observation => observation.competitorId === 'baan-tham-pai');
  assert.ok(baanThamPaiObservation);
  assert.match(baanThamPaiObservation.summary, /ร้านบ้านทำป้ายแกะสลัก/);
  assert.match(baanThamPaiObservation.summary, /บ้านสันติภาพ 119 ตำบล รอบเมือง อำเภอเมืองร้อยเอ็ด 45000/);
  assert.equal(baanThamPaiObservation.sourceUrl, 'https://www.google.com/maps?cid=15093723125795807870');
  const kasetWisaiObservation = observations.find(observation => observation.competitorId === 'pai-hin-kae-salak-kasetwisai');
  assert.ok(kasetWisaiObservation);
  assert.match(kasetWisaiObservation.summary, /ป้ายหินแกะสลัก/);
  assert.match(kasetWisaiObservation.summary, /MH4P\+GRV ตำบล เกษตรวิสัย อำเภอ เกษตรวิสัย ร้อยเอ็ด 45150/);
  assert.equal(kasetWisaiObservation.sourceUrl, competitorsById.get('pai-hin-kae-salak-kasetwisai').sourceUrls[0]);
  const wannasutObservation = observations.find(observation => observation.competitorId === 'wannasut-art-and-com');
  assert.ok(wannasutObservation);
  assert.match(wannasutObservation.summary, /วรรณสุทธิ์ อาร์ต แอนด์ คอม/);
  assert.match(wannasutObservation.summary, /อำเภอสุวรรณภูมิ/);
  assert.match(wannasutObservation.summary, /จังหวัดร้อยเอ็ด 45130/);
  assert.match(wannasutObservation.summary, /ป้ายหินอ่อน/);
  assert.match(wannasutObservation.summary, /หินแกรนิต/);
  assert.equal(wannasutObservation.sourceUrl, competitorsById.get('wannasut-art-and-com').sourceUrls[0]);
  assert.equal(observations.some(observation => observation.competitorId === 'chinna-kae-salak-pai-hin'), false);
  assert.equal(observations.some(observation => observation.competitorId === 'ran-phong-granite'), false);
  assert.ok(observations.some(observation => observation.competitorId === 'phlanchai-pai-hin'));
  assert.ok(observations.some(observation => observation.competitorId === 'ran-fa-tak'));
});

test('digest filters observations to the selected UTC date', () => {
  const registry = {
    version: 1,
    competitors: [verifiedCompetitor('stone-b', 'Stone B'), verifiedCompetitor('stone-a', 'Stone A')]
  };
  const observations = [
    { competitorId: 'stone-b', summary: 'B observation', sourceUrl: 'https://example.com/b', observedAt: '2026-08-28T02:00:00Z' },
    { competitorId: 'stone-a', summary: 'A observation', sourceUrl: 'https://example.com/a', observedAt: '2026-08-28T01:00:00Z' },
    { competitorId: 'stone-a', summary: 'Previous day', sourceUrl: 'https://example.com/previous', observedAt: '2026-08-27T23:59:59Z' },
    { competitorId: 'stone-b', summary: 'Next day', sourceUrl: 'https://example.com/next', observedAt: '2026-08-29T00:00:00Z' }
  ];
  const first = buildDailyDigest({ registry, observations, date: '2026-08-28' });
  const second = buildDailyDigest({ registry, observations: observations.reverse(), date: '2026-08-28' });
  assert.equal(first, second);
  assert.ok(first.indexOf('Stone A') < first.indexOf('Stone B'));
  assert.match(first, /https:\/\/example\.com\/a/);
  assert.match(first, /https:\/\/example\.com\/b/);
  assert.doesNotMatch(first, /Previous day|https:\/\/example\.com\/previous/);
  assert.doesNotMatch(first, /Next day|https:\/\/example\.com\/next/);
  assert.match(first, /Verified observations[\s\S]*Interpretation/);
  assert.match(first, /ไม่มีการตีความอัตโนมัติ/);
  assert.doesNotMatch(first, /ราคา|โปรโมชั่น|ส่วนลด/);
});

test('selected date with no observations does not show observations from other dates', () => {
  const registry = { version: 1, competitors: [verifiedCompetitor()] };
  const digest = buildDailyDigest({
    registry,
    observations: [{
      competitorId: 'stone-a',
      summary: 'Other date only',
      sourceUrl: 'https://example.com/other',
      observedAt: '2026-08-27T12:00:00Z'
    }],
    date: '2026-08-28'
  });
  assert.match(digest, /ไม่มีข้อมูลที่ตรวจสอบแหล่งอ้างอิงได้สำหรับวันที่รายงาน 2026-08-28/);
  assert.doesNotMatch(digest, /Other date only|https:\/\/example\.com\/other/);
  assert.match(digest, /Verified observations[\s\S]*Interpretation/);
  assert.match(digest, /ไม่มีการตีความอัตโนมัติ/);
});
