const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createJobStore,
  InvalidTransitionError,
  UnknownStatusError,
  ValidationError,
  PersistenceError
} = require('../tools/job_store');

function validJob(overrides = {}) {
  return {
    customer: { name: 'ลูกค้า', phone: '0800000000' },
    quoteNumber: 'QT-REPORT',
    job: {
      jobType: 'ป้าย', notes: 'หมายเหตุ', material: 'granite_black',
      widthCm: 30, heightCm: 20, depthMm: 3, quantity: 1,
      complexity: 'standard', rush: false, paint: false, install: false
    },
    result: { total: 123.45, currency: 'THB', quantity: 1 },
    ...overrides
  };
}

function create(store, overrides = {}) {
  return store.createJob(validJob(overrides));
}

test('reports expose zero-safe summary and daily/weekly shapes', () => {
  const store = createJobStore({ dbPath: ':memory:' });
  assert.deepEqual(store.reports.getStatusCounts(), {
    counts: { 'รอผลิต': 0, 'กำลังผลิต': 0, 'เสร็จแล้ว': 0, 'ส่งแล้ว': 0 },
    totalJobs: 0, openValueSatang: 0, deliveredValueSatang: 0, currency: 'THB'
  });
  assert.deepEqual(store.reports.listQueue(), []);
  assert.deepEqual(store.reports.getDailyReport({ date: '2026-08-28' }), {
    date: '2026-08-28', timezone: 'Asia/Bangkok',
    created: { jobCount: 0, totalSatang: 0 },
    delivered: { jobCount: 0, totalSatang: 0 }, currency: 'THB'
  });
  assert.deepEqual(store.reports.getWeeklyReport({ weekStart: '2026-08-24' }), {
    weekStart: '2026-08-24', weekEnd: '2026-08-30', timezone: 'Asia/Bangkok',
    created: { jobCount: 0, totalSatang: 0 },
    delivered: { jobCount: 0, totalSatang: 0 }, currency: 'THB'
  });
  store.close();
});

test('summary and queue aggregate all statuses without exposing private columns', () => {
  const store = createJobStore({ dbPath: ':memory:' });
  const first = create(store, { quoteNumber: 'Q1' });
  const second = create(store, { quoteNumber: 'Q2', result: { total: 200, currency: 'THB' } });
  const third = create(store, { quoteNumber: 'Q3', result: { total: 300, currency: 'THB' } });
  const fourth = create(store, { quoteNumber: 'Q4', result: { total: 400, currency: 'THB' } });
  store.updateStatus(String(second.job_id), 'กำลังผลิต');
  store.updateStatus(String(third.job_id), 'กำลังผลิต');
  store.updateStatus(String(third.job_id), 'เสร็จแล้ว');
  for (const next of ['กำลังผลิต', 'เสร็จแล้ว', 'ส่งแล้ว']) store.updateStatus(String(fourth.job_id), next);

  const summary = store.reports.getStatusCounts();
  assert.deepEqual(summary.counts, { 'รอผลิต': 1, 'กำลังผลิต': 1, 'เสร็จแล้ว': 1, 'ส่งแล้ว': 1 });
  assert.equal(summary.totalJobs, 4);
  assert.equal(summary.openValueSatang, first.total_satang + second.total_satang + third.total_satang);
  assert.equal(summary.deliveredValueSatang, fourth.total_satang);
  const queue = store.reports.listQueue({ status: 'กำลังผลิต' });
  assert.deepEqual(queue.map(job => job.jobId), [second.job_id]);
  assert.deepEqual(Object.keys(queue[0]).sort(), [
    'createdAt', 'customerName', 'heightCm', 'jobId', 'jobType', 'material',
    'quantity', 'quoteNumber', 'rush', 'status', 'totalSatang', 'updatedAt', 'widthCm'
  ].sort());
  assert.equal('customerPhone' in queue[0], false);
  assert.equal('pricingSnapshot' in queue[0], false);
  store.close();
});

test('daily and weekly reports use Bangkok boundaries and terminal delivery status', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oas-reports-'));
  const dbPath = path.join(directory, 'jobs.db');
  let store = createJobStore({ dbPath });
  const boundaryBefore = create(store, { quoteNumber: 'BEFORE' });
  const boundaryAt = create(store, { quoteNumber: 'AT' });
  const openUpdated = create(store, { quoteNumber: 'OPEN' });
  const delivered = create(store, { quoteNumber: 'DELIVERED' });
  store.updateStatus(String(delivered.job_id), 'กำลังผลิต');
  store.updateStatus(String(delivered.job_id), 'เสร็จแล้ว');
  store.updateStatus(String(delivered.job_id), 'ส่งแล้ว');
  store.close();

  const db = new DatabaseSync(dbPath);
  db.prepare('UPDATE jobs SET created_at = ?, updated_at = ? WHERE job_id = ?').run('2026-08-27T16:59:59.999Z', '2026-08-27T16:59:59.999Z', boundaryBefore.job_id);
  db.prepare('UPDATE jobs SET created_at = ?, updated_at = ? WHERE job_id = ?').run('2026-08-27T17:00:00.000Z', '2026-08-27T17:00:00.000Z', boundaryAt.job_id);
  db.prepare('UPDATE jobs SET created_at = ?, updated_at = ? WHERE job_id = ?').run('2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', openUpdated.job_id);
  db.prepare('UPDATE jobs SET created_at = ?, updated_at = ? WHERE job_id = ?').run('2025-12-28T17:00:00.000Z', '2025-12-29T17:00:00.000Z', delivered.job_id);
  db.close();

  store = createJobStore({ dbPath });
  const daily = store.reports.getDailyReport({ date: '2026-08-28' });
  assert.equal(daily.created.jobCount, 2);
  assert.equal(daily.delivered.jobCount, 0);
  const weekly = store.reports.getWeeklyReport({ weekStart: '2025-12-29' });
  assert.equal(weekly.weekEnd, '2026-01-04');
  assert.equal(weekly.created.jobCount, 1);
  assert.equal(weekly.delivered.jobCount, 1);
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('date and status validation fails closed', () => {
  const store = createJobStore({ dbPath: ':memory:' });
  assert.throws(() => store.reports.getDailyReport({ date: '2026-02-30' }), ValidationError);
  assert.throws(() => store.reports.getWeeklyReport({ weekStart: '2026-08-25' }), ValidationError);
  assert.throws(() => store.reports.listQueue({ status: 'DROP TABLE jobs' }), UnknownStatusError);
  assert.throws(() => store.reports.getDailyReport({}), ValidationError);
  store.close();
});

test('terminal jobs reject every other transition through the public store API', () => {
  const store = createJobStore({ dbPath: ':memory:' });
  const job = create(store);
  for (const next of ['กำลังผลิต', 'เสร็จแล้ว', 'ส่งแล้ว']) store.updateStatus(String(job.job_id), next);
  const final = store.getJob(String(job.job_id));
  for (const next of ['รอผลิต', 'กำลังผลิต', 'เสร็จแล้ว']) {
    assert.throws(() => store.updateStatus(String(job.job_id), next), InvalidTransitionError);
  }
  assert.deepEqual(store.getJob(String(job.job_id)), final);
  store.close();
});

test('report persistence failures are generic', () => {
  const reports = require('../tools/job_reports').createJobReports({ db: { prepare() { throw new Error('secret path'); } } });
  assert.throws(() => reports.getStatusCounts(), error => error instanceof PersistenceError && error.message === 'job reporting unavailable');
});
