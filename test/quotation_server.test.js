const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../server');

let server;
let baseUrl;

function validQuote(overrides = {}) {
  return {
    customerName: 'Test Customer',
    phone: '0800000000',
    jobType: 'Stone sign',
    material: 'granite',
    widthCm: 30,
    heightCm: 20,
    quantity: 1,
    complexity: 'standard',
    rush: false,
    ...overrides
  };
}

async function preview(body) {
  return fetch(`${baseUrl}/api/quotes/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test.before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('POST /api/quotes/preview returns 200 for a valid quote', async () => {
  const response = await preview(validQuote());

  assert.equal(response.status, 200);
});

test('valid quote response follows the expected JSON schema', async () => {
  const response = await preview(validQuote());
  const body = await response.json();

  assert.deepEqual(Object.keys(body).sort(), [
    'createdAt',
    'currency',
    'customer',
    'job',
    'quoteNumber',
    'result',
    'shopName'
  ]);
  assert.equal(typeof body.quoteNumber, 'string');
  assert.match(body.quoteNumber, /^QT-\d{8}-\d{6}$/);
  assert.deepEqual(body.customer, { name: 'Test Customer', phone: '0800000000' });
  assert.equal(body.job.material, 'granite');
  assert.equal(body.currency, 'THB');
  assert.equal(typeof body.result.total, 'number');
  assert.deepEqual(Object.keys(body.result.breakdown).sort(), [
    'cnc',
    'depth',
    'installation',
    'material',
    'paint',
    'setup'
  ]);
});

test('invalid material returns a 400 error', async () => {
  const response = await preview(validQuote({ material: 'limestone' }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /material is unknown: limestone/);
});

test('missing required fields return a 400 error', async () => {
  const response = await preview(validQuote({ customerName: '' }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, 'customerName is required');
});

test('negative dimensions return a 400 error', async () => {
  const response = await preview(validQuote({ heightCm: -1 }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /height_cm must be a non-negative number/);
});

test('an empty request body returns a 400 error', async () => {
  const response = await preview({});
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, 'customerName is required');
});

test('identical requests produce the same pricing result', async () => {
  const [firstResponse, secondResponse] = await Promise.all([
    preview(validQuote()),
    preview(validQuote())
  ]);
  const [first, second] = await Promise.all([
    firstResponse.json(),
    secondResponse.json()
  ]);

  assert.deepEqual(first.result, second.result);
});

test('unsupported HTTP methods return 404', async () => {
  const response = await fetch(`${baseUrl}/api/quotes/preview`);

  assert.equal(response.status, 404);
});

test('concurrent requests return independent successful quotes', async () => {
  const responses = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      preview(validQuote({ customerName: `Customer ${index}`, widthCm: 30 + index }))
    )
  );
  const bodies = await Promise.all(responses.map(response => response.json()));

  assert.ok(responses.every(response => response.status === 200));
  assert.deepEqual(
    bodies.map(body => body.customer.name),
    Array.from({ length: 10 }, (_, index) => `Customer ${index}`)
  );
  assert.ok(bodies.every(body => Number.isFinite(body.result.total)));
});

test('malformed JSON receives a 400 error response', async () => {
  const response = await fetch(`${baseUrl}/api/quotes/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"customerName":'
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, { error: 'Invalid JSON request body' });
});
