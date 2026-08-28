const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MarketDataError,
  buildDailyDigest,
  validateObservation
} = require('../tools/market_intelligence');

test('empty competitor registry produces setup guidance', () => {
  const text = buildDailyDigest({ registry: { version: 1, competitors: [] }, observations: [], date: '2026-08-28' });
  assert.match(text, /ยังไม่ได้เพิ่มคู่แข่งในระบบ/);
});

test('digest includes only known competitors and source URLs', () => {
  const registry = { version: 1, competitors: [{ id: 'stone-a', name: 'ร้านหิน A' }] };
  const text = buildDailyDigest({
    registry,
    date: '2026-08-28',
    observations: [
      { competitorId: 'stone-a', summary: 'ลงโปรโมชั่นใหม่', sourceUrl: 'https://example.com/a', observedAt: '2026-08-28T01:00:00Z' },
      { competitorId: 'unknown', summary: 'ข้อมูลอื่น', sourceUrl: 'https://example.com/b', observedAt: '2026-08-28T02:00:00Z' }
    ]
  });
  assert.match(text, /ร้านหิน A/);
  assert.match(text, /https:\/\/example.com\/a/);
  assert.doesNotMatch(text, /ข้อมูลอื่น/);
});

test('digest states when no cited observations exist', () => {
  const registry = { version: 1, competitors: [{ id: 'stone-a', name: 'ร้านหิน A' }] };
  const text = buildDailyDigest({ registry, observations: [], date: '2026-08-28' });
  assert.match(text, /วันนี้ยังไม่มีข้อมูลที่ตรวจสอบแหล่งอ้างอิงได้/);
});

test('observations require a valid URL and timestamp', () => {
  assert.throws(() => validateObservation({ competitorId: 'a', summary: 'x', sourceUrl: 'bad', observedAt: '2026-08-28T00:00:00Z' }), MarketDataError);
  assert.throws(() => validateObservation({ competitorId: 'a', summary: 'x', sourceUrl: 'https://example.com', observedAt: 'bad' }), MarketDataError);
});
