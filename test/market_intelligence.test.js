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

test('empty registry returns setup guidance without fabricated content', () => {
  const digest = buildConfiguredDailyDigest({ date: '2026-08-28' });
  assert.match(digest, /ยังไม่ได้ตั้งค่า competitor registry/);
  assert.match(digest, /Verified observations/);
  assert.match(digest, /Interpretation/);
});

test('malformed registry and observations fail safely', () => {
  assert.throws(() => loadCompetitorRegistry(tempJson({ version: 2, competitors: [] })), MarketDataError);
  const registry = { version: 1, competitors: [{ id: 'stone-a', name: 'Stone A' }] };
  assert.throws(() => loadObservations(tempJson({ version: 1, observations: [{ competitorId: 'stone-a' }] }), registry), MarketDataError);
  assert.throws(() => loadObservations(tempJson({ version: 1, observations: [{ competitorId: 'stone-a', summary: 'x', sourceUrl: 'ftp://example.com', observedAt: '2026-08-28T00:00:00Z' }] }), registry), MarketDataError);
});

test('unknown competitor IDs, missing URLs, and invalid timestamps fail closed', () => {
  const registry = { version: 1, competitors: [{ id: 'stone-a', name: 'Stone A' }] };
  assert.throws(() => buildDailyDigest({ registry, observations: [{ competitorId: 'unknown', summary: 'x', sourceUrl: 'https://example.com', observedAt: '2026-08-28T00:00:00Z' }] }), MarketDataError);
  assert.throws(() => validateObservation({ competitorId: 'stone-a', summary: 'x', observedAt: '2026-08-28T00:00:00Z' }), MarketDataError);
  assert.throws(() => validateObservation({ competitorId: 'stone-a', summary: 'x', sourceUrl: 'https://example.com', observedAt: 'not-a-date' }), MarketDataError);
});

test('digest output is deterministic, ordered, sourced, and separates interpretation', () => {
  const registry = {
    version: 1,
    competitors: [{ id: 'stone-b', name: 'Stone B' }, { id: 'stone-a', name: 'Stone A' }]
  };
  const observations = [
    { competitorId: 'stone-b', summary: 'B observation', sourceUrl: 'https://example.com/b', observedAt: '2026-08-28T02:00:00Z' },
    { competitorId: 'stone-a', summary: 'A observation', sourceUrl: 'https://example.com/a', observedAt: '2026-08-28T01:00:00Z' }
  ];
  const first = buildDailyDigest({ registry, observations, date: '2026-08-28' });
  const second = buildDailyDigest({ registry, observations: observations.reverse(), date: '2026-08-28' });
  assert.equal(first, second);
  assert.ok(first.indexOf('Stone A') < first.indexOf('Stone B'));
  assert.match(first, /https:\/\/example\.com\/a/);
  assert.match(first, /https:\/\/example\.com\/b/);
  assert.match(first, /Verified observations[\s\S]*Interpretation/);
  assert.match(first, /ไม่มีการตีความอัตโนมัติ/);
  assert.doesNotMatch(first, /ราคา|โปรโมชั่น|ส่วนลด/);
});
