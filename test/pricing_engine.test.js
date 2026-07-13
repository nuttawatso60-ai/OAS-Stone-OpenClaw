const test = require('node:test');
const assert = require('node:assert/strict');

const rules = require('../data/pricing_rules.json');
const sampleJobs = require('../data/sample_jobs.json');
const { calculateJobPrice } = require('../tools/pricing_engine');

function graniteJob(overrides = {}) {
  return {
    id: 'TEST-GRANITE',
    material: 'granite',
    width_cm: 30,
    height_cm: 20,
    depth_mm: 3,
    quantity: 1,
    paint: false,
    install: false,
    rush: false,
    ...overrides
  };
}

test('calculates a basic granite job', () => {
  const result = calculateJobPrice(graniteJob(), rules);

  assert.equal(result.material, 'granite');
  assert.equal(result.area_cm2, 600);
  assert.equal(result.breakdown.material, 720);
  assert.equal(result.breakdown.cnc, 194.4);
  assert.equal(result.total, 1064.4);
});

test('calculates a marble job from the sample data', () => {
  const marbleJob = sampleJobs.find(job => job.material === 'marble');
  const result = calculateJobPrice(marbleJob, rules);

  assert.equal(result.material, 'marble');
  assert.equal(result.total, 4470.18);
});

test('adds CNC depth pricing above the depth threshold', () => {
  const shallow = calculateJobPrice(graniteJob({ depth_mm: 4 }), rules);
  const deep = calculateJobPrice(graniteJob({ depth_mm: 6 }), rules);

  assert.equal(shallow.breakdown.depth, 0);
  assert.equal(deep.breakdown.depth, 96);
  assert.equal(deep.cnc_minutes, 12.53);
  assert.ok(deep.total > shallow.total);
});

test('adds paint finish pricing', () => {
  const unpainted = calculateJobPrice(graniteJob(), rules);
  const painted = calculateJobPrice(graniteJob({ paint: true }), rules);

  assert.equal(painted.breakdown.paint, 210);
  assert.equal(painted.total - unpainted.total, 210);
});

test('adds the installation fee', () => {
  const withoutInstallation = calculateJobPrice(graniteJob(), rules);
  const withInstallation = calculateJobPrice(graniteJob({ install: true }), rules);

  assert.equal(withInstallation.breakdown.installation, 1200);
  assert.equal(withInstallation.total - withoutInstallation.total, 1200);
});

test('applies the rush surcharge', () => {
  const standard = calculateJobPrice(graniteJob(), rules);
  const rush = calculateJobPrice(graniteJob({ rush: true }), rules);

  assert.equal(rush.rush_multiplier, 1.3);
  assert.equal(rush.total, 1383.72);
  assert.equal(rush.total, Math.round(standard.total * rules.rush_multiplier * 100) / 100);
});

test('rejects an invalid material', () => {
  assert.throws(
    () => calculateJobPrice(graniteJob({ material: 'limestone' }), rules),
    /job TEST-GRANITE\.material is unknown: limestone/
  );
});

test('rejects a missing required field', () => {
  assert.throws(
    () => calculateJobPrice({ ...graniteJob(), id: '' }, rules),
    /job\.id must be a non-empty string/
  );
});

test('rejects zero and negative dimensions', async (t) => {
  await t.test('zero width', () => {
    assert.throws(
      () => calculateJobPrice(graniteJob({ width_cm: 0 }), rules),
      /job TEST-GRANITE\.width_cm must be greater than 0/
    );
  });

  await t.test('negative height', () => {
    assert.throws(
      () => calculateJobPrice(graniteJob({ height_cm: -1 }), rules),
      /job TEST-GRANITE\.height_cm must be a non-negative number/
    );
  });
});

test('returns the same total for identical input', () => {
  const job = graniteJob({ depth_mm: 6, paint: true, install: true, rush: true });

  assert.equal(
    calculateJobPrice(job, rules).total,
    calculateJobPrice(job, rules).total
  );
});
