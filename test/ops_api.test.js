const fs = require('node:fs');
const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { createJobStore } = require('../tools/job_store');

let server;
let baseUrl;
let store;

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

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, { headers: { 'content-type': 'application/json' }, ...options });
}

async function createJob(name = 'OPS customer') {
  const response = await request('/api/jobs', {
    method: 'POST',
    body: JSON.stringify({ customerName: name, phone: '0800000000', jobType: 'ป้าย', material: 'granite', widthCm: 30, heightCm: 20, quantity: 1, complexity: 'standard', rush: false })
  });
  assert.equal(response.status, 201);
  return response.json();
}

test('OPS summary and queue are read-only projections', async () => {
  const job = await createJob();
  const summary = await request('/api/ops/summary');
  assert.equal(summary.status, 200);
  assert.equal((await summary.json()).totalJobs, 1);
  const queue = await request('/api/ops/queue');
  const body = await queue.json();
  assert.equal(queue.status, 200);
  assert.equal(body[0].jobId, job.job_id);
  assert.equal('customerPhone' in body[0], false);
  assert.equal('pricingSnapshot' in body[0], false);
});

test('OPS routes validate filters and dates', async () => {
  const badStatus = await request('/api/ops/queue?status=DROP%20TABLE%20jobs');
  assert.equal(badStatus.status, 400);
  const badDate = await request('/api/ops/reports/daily?date=2026-02-30');
  assert.equal(badDate.status, 400);
  const badWeek = await request('/api/ops/reports/weekly?weekStart=2026-08-25');
  assert.equal(badWeek.status, 400);
});

test('OPS methods other than GET do not create write endpoints', async () => {
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const response = await request('/api/ops/summary', { method });
    assert.equal(response.status, 404, method);
  }
});

// The bind address is configurable so a phone or tablet on the same network can
// reach the pricing app, but the default must stay loopback-only: LAN exposure
// has to be an explicit opt-in, never something a plain `npm run dev` does.
test('production listener defaults to loopback and binds the configured host', () => {
  const source = fs.readFileSync(require.resolve('../server'), 'utf8');
  assert.match(source, /const HOST = process\.env\.HOST \|\| '127\.0\.0\.1';/);
  assert.match(source, /app\.listen\(PORT, HOST,/);
});

test('the default host resolves to loopback when HOST is unset', () => {
  const previous = process.env.HOST;
  delete process.env.HOST;
  try {
    assert.equal(process.env.HOST || '127.0.0.1', '127.0.0.1');
  } finally {
    if (previous === undefined) delete process.env.HOST;
    else process.env.HOST = previous;
  }
});
