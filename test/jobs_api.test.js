const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../server');
const {
  createJobStore,
  PersistenceError
} = require('../tools/job_store');

let server;
let baseUrl;
let store;

function validJob(overrides = {}) {
  return {
    customerName: 'Test Customer',
    phone: '0800000000',
    jobType: 'Stone sign',
    notes: 'engraving',
    material: 'granite',
    widthCm: 30,
    heightCm: 20,
    quantity: 2,
    complexity: 'standard',
    rush: false,
    ...overrides
  };
}

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    headers: { 'content-type': 'application/json', ...options.headers },
    ...options
  });
}

test.before(async () => {
  store = createJobStore({ dbPath: ':memory:' });
  server = http.createServer(createApp({ jobStore: store }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  store.close();
});

test('POST /api/jobs creates a persisted job with status and satang', async () => {
  const response = await request('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(validJob())
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.job_id, 1);
  assert.equal(body.status, 'รอผลิต');
  assert.equal(body.customer_name, 'Test Customer');
  assert.equal(body.total_satang, Math.round(body.pricing_snapshot.total * 100));
  assert.match(body.created_at, /Z$/);
  assert.match(body.updated_at, /Z$/);
});

test('POST /api/jobs validates pricing inputs consistently with preview', async () => {
  const invalidMaterial = await request('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(validJob({ material: 'limestone' }))
  });
  const invalidBody = await invalidMaterial.json();
  assert.equal(invalidMaterial.status, 400);
  assert.match(invalidBody.error, /material is unknown: limestone/);

  const missingField = await request('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(validJob({ customerName: '' }))
  });
  const missingBody = await missingField.json();
  assert.equal(missingField.status, 400);
  assert.equal(missingBody.error, 'customerName is required');
});

test('GET /api/jobs lists jobs and filters by status', async () => {
  const first = await request('/api/jobs');
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.deepEqual(firstBody.map(job => job.job_id), [1]);

  const created = await request('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(validJob({ customerName: 'Second' }))
  });
  assert.equal(created.status, 201);
  const status = await request('/api/jobs/2/status', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'กำลังผลิต' })
  });
  assert.equal(status.status, 200);

  const filtered = await request('/api/jobs?status=%E0%B8%81%E0%B8%B3%E0%B8%A5%E0%B8%B1%E0%B8%87%E0%B8%9C%E0%B8%A5%E0%B8%B4%E0%B8%95');
  assert.deepEqual((await filtered.json()).map(job => job.job_id), [2]);
});

test('GET /api/jobs/:jobId validates IDs and returns 404 for unknown jobs', async () => {
  const known = await request('/api/jobs/1');
  assert.equal(known.status, 200);
  assert.equal((await known.json()).job_id, 1);

  for (const jobId of ['0', '01', '1.0', '1e3', '-1', ' 1']) {
    const response = await request(`/api/jobs/${encodeURIComponent(jobId)}`);
    assert.equal(response.status, 400, `invalid ID ${jobId}`);
  }
  const unknown = await request('/api/jobs/999');
  assert.equal(unknown.status, 404);
});

test('PATCH /api/jobs/:jobId/status maps transition and status errors', async () => {
  const valid = await request('/api/jobs/1/status', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'กำลังผลิต' })
  });
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).status, 'กำลังผลิต');

  const skipped = await request('/api/jobs/1/status', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'ส่งแล้ว' })
  });
  assert.equal(skipped.status, 409);

  const badStatus = await request('/api/jobs/1/status', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'DROP TABLE jobs' })
  });
  assert.equal(badStatus.status, 400);

  const missing = await request('/api/jobs/999/status', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'กำลังผลิต' })
  });
  assert.equal(missing.status, 404);
});

test('concurrent POST /api/jobs requests receive unique IDs', async () => {
  const responses = await Promise.all(
    Array.from({ length: 100 }, (_, index) => request('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(validJob({ customerName: `Customer ${index}` }))
    }))
  );
  const bodies = await Promise.all(responses.map(response => response.json()));
  const ids = bodies.map(body => body.job_id).sort((a, b) => a - b);

  assert.ok(responses.every(response => response.status === 201));
  assert.deepEqual(ids, Array.from({ length: 100 }, (_, index) => index + 3));
});

test('persistence failures return generic 503 without SQLite or path leakage', async () => {
  const failingStore = {
    createJob() {
      throw new PersistenceError('SQLITE_CANTOPEN D:\\secret\\jobs.db');
    }
  };
  const failingServer = http.createServer(createApp({ jobStore: failingStore }));
  await new Promise(resolve => failingServer.listen(0, '127.0.0.1', resolve));
  const failingUrl = `http://127.0.0.1:${failingServer.address().port}`;
  const response = await fetch(`${failingUrl}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validJob())
  });
  const body = await response.json();
  await new Promise((resolve, reject) => failingServer.close(error => error ? reject(error) : resolve()));

  assert.equal(response.status, 503);
  assert.deepEqual(body, { error: 'Job persistence unavailable' });
});
