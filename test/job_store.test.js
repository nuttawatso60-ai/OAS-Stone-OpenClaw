const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const {
  createJobStore,
  InvalidTransitionError,
  JobNotFoundError,
  PersistenceError,
  UnknownStatusError,
  ValidationError
} = require('../tools/job_store');

function makeJob(overrides = {}) {
  return {
    jobType: 'Stone sign',
    notes: 'engraving',
    material: 'granite',
    widthCm: 30,
    heightCm: 20,
    depthMm: 3,
    quantity: 2,
    complexity: 'standard',
    rush: false,
    paint: false,
    install: false,
    ...overrides
  };
}

function makeCreateInput(overrides = {}) {
  return {
    customer: { name: 'Test Customer', phone: '0800000000' },
    job: makeJob(),
    result: { total: 1234.56, material: 'granite', breakdown: { material: 500 } },
    quoteNumber: 'QT-20260828-120000',
    ...overrides
  };
}

function createStore(t) {
  const store = createJobStore({ dbPath: ':memory:' });
  t.after(() => store.close());
  return store;
}

function createFileStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'job-store-'));
  const dbPath = path.join(directory, 'jobs.db');
  const store = createJobStore({ dbPath });
  return { store, dbPath, directory };
}

function createJob(store, overrides = {}) {
  return store.createJob(makeCreateInput(overrides));
}

test('job store initializes schema version 1 and starts IDs at 1', t => {
  const store = createStore(t);
  const job = createJob(store);

  assert.equal(job.job_id, 1);
  assert.equal(job.status, 'รอผลิต');
  assert.equal(job.rush, false);
  assert.equal(job.total_satang, 123456);
  assert.match(job.created_at, /Z$/);
  assert.equal(job.created_at, job.updated_at);
});

test('job IDs are monotonic and AUTOINCREMENT does not reuse deleted IDs', t => {
  const { store, dbPath, directory } = createFileStore();
  const first = createJob(store, { quoteNumber: 'QT-1' });
  const second = createJob(store, { quoteNumber: 'QT-2' });

  assert.equal(first.job_id, 1);
  assert.equal(second.job_id, 2);
  store.close();
  const db = new DatabaseSync(dbPath);
  db.prepare('DELETE FROM jobs WHERE job_id = ?').run(2);
  db.close();

  const reopened = createJobStore({ dbPath });
  t.after(() => {
    reopened.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(createJob(reopened, { quoteNumber: 'QT-3' }).job_id, 3);
});

test('filesystem database persists across reopen', t => {
  const { store, dbPath, directory } = createFileStore();
  const created = createJob(store);
  store.close();

  const reopened = createJobStore({ dbPath });
  t.after(() => {
    reopened.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  assert.deepEqual(reopened.getJob(String(created.job_id)), created);
});

test('createJob always uses the initial status and ignores extra status input', t => {
  const store = createStore(t);
  const job = createJob(store, { job: makeJob({ status: 'ส่งแล้ว' }) });

  assert.equal(job.status, 'รอผลิต');
});

test('status transitions follow the explicit chain', t => {
  const store = createStore(t);
  const job = createJob(store);

  const producing = store.updateStatus(String(job.job_id), 'กำลังผลิต');
  const finished = store.updateStatus(String(job.job_id), 'เสร็จแล้ว');
  const delivered = store.updateStatus(String(job.job_id), 'ส่งแล้ว');

  assert.equal(producing.status, 'กำลังผลิต');
  assert.equal(finished.status, 'เสร็จแล้ว');
  assert.equal(delivered.status, 'ส่งแล้ว');
});

test('status transitions reject skips, backwards, and terminal updates', t => {
  const store = createStore(t);
  const job = createJob(store);

  assert.throws(() => store.updateStatus('1', 'เสร็จแล้ว'), InvalidTransitionError);
  store.updateStatus('1', 'กำลังผลิต');
  assert.throws(() => store.updateStatus('1', 'รอผลิต'), InvalidTransitionError);
  store.updateStatus('1', 'เสร็จแล้ว');
  store.updateStatus('1', 'ส่งแล้ว');
  assert.throws(() => store.updateStatus('1', 'เสร็จแล้ว'), InvalidTransitionError);
});

test('same-state status updates are idempotent and preserve updated_at', t => {
  const store = createStore(t);
  const created = createJob(store);
  const same = store.updateStatus('1', 'รอผลิต'.normalize('NFC'));

  assert.deepEqual(same, created);
});

test('unknown statuses fail closed', t => {
  const store = createStore(t);
  createJob(store);

  assert.throws(() => store.listJobs({ status: 'DROP TABLE jobs' }), UnknownStatusError);
  assert.throws(() => store.updateStatus('1', 'DROP TABLE jobs'), UnknownStatusError);
});

test('unknown jobs and invalid job IDs are rejected', t => {
  const store = createStore(t);
  createJob(store);

  assert.throws(() => store.getJob('2'), JobNotFoundError);
  for (const value of ['0', '-1', '1e3', '01', '1.0', ' 1', String(Number.MAX_SAFE_INTEGER + 1), 1]) {
    assert.throws(() => store.getJob(value), ValidationError, `invalid job ID: ${value}`);
  }
});

test('listJobs is deterministic and supports status filtering', t => {
  const store = createStore(t);
  createJob(store, { quoteNumber: 'QT-3' });
  createJob(store, { quoteNumber: 'QT-1' });
  createJob(store, { quoteNumber: 'QT-2' });
  store.updateStatus('2', 'กำลังผลิต');

  assert.deepEqual(store.listJobs().map(job => job.job_id), [1, 2, 3]);
  assert.deepEqual(store.listJobs({ status: 'กำลังผลิต' }).map(job => job.job_id), [2]);
});

test('customer fields and snapshots are stored literally with exact satang', t => {
  const store = createStore(t);
  const job = createJob(store, {
    customer: { name: "Robert'); DROP TABLE jobs; --", phone: "' OR 1=1 --" },
    result: { total: 10.005, nested: { text: "don't execute" } }
  });
  const loaded = store.getJob('1');

  assert.equal(loaded.customer_name, "Robert'); DROP TABLE jobs; --");
  assert.equal(loaded.customer_phone, "' OR 1=1 --");
  assert.equal(loaded.total_satang, 1001);
  assert.deepEqual(loaded.pricing_snapshot, { total: 10.005, nested: { text: "don't execute" } });
  assert.equal(store.listJobs().length, 1);
  assert.throws(
    () => createJob(store, { result: { total: Number.MAX_VALUE } }),
    ValidationError
  );
});

test('NFC-normalized status input follows the same transition contract', t => {
  const store = createStore(t);
  createJob(store);

  assert.equal(store.updateStatus('1', 'กำลังผลิต'.normalize('NFD')).status, 'กำลังผลิต');
});

test('closed stores and database open failures become PersistenceError', t => {
  const store = createStore(t);
  store.close();
  assert.throws(() => store.listJobs(), PersistenceError);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'job-store-failure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => createJobStore({ dbPath: directory }), PersistenceError);
});

test('read-only database writes fail as PersistenceError where permissions are reliable', t => {
  if (process.platform === 'win32') {
    t.skip('filesystem permissions are not reliable for this test on Windows');
    return;
  }

  const { store, dbPath, directory } = createFileStore();
  store.close();
  fs.chmodSync(dbPath, 0o444);
  const readOnlyStore = createJobStore({ dbPath });
  t.after(() => {
    readOnlyStore.close();
    fs.chmodSync(dbPath, 0o644);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  assert.throws(() => createJob(readOnlyStore), PersistenceError);
});

test('unsafe database paths are rejected', () => {
  assert.throws(() => createJobStore({ dbPath: 'bad\0jobs.db' }), ValidationError);
  assert.throws(() => createJobStore({ dbPath: 'data/../jobs.db' }), ValidationError);
  assert.throws(() => createJobStore({ dbPath: '\\\\?\\C:\\jobs.db' }), ValidationError);
});

test('database schema version is initialized and future versions fail closed', t => {
  const { store, dbPath, directory } = createFileStore();
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  store.close();
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  db.exec('PRAGMA user_version = 2');
  db.close();

  assert.throws(() => createJobStore({ dbPath }), PersistenceError);
});

test('sequential burst allocates 100 unique monotonic IDs', t => {
  const store = createStore(t);
  const jobs = Array.from({ length: 100 }, (_, index) =>
    createJob(store, { quoteNumber: `QT-${index}` })
  );

  assert.deepEqual(jobs.map(job => job.job_id), Array.from({ length: 100 }, (_, index) => index + 1));
});
