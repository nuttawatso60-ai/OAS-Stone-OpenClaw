const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../server');

let server;
let baseUrl;

function priceRequest(body, { raw = false } = {}) {
  return fetch(`${baseUrl}/api/price`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? body : JSON.stringify(body)
  });
}

function validPrice(overrides = {}) {
  return { material: 'granite', widthCm: 20, heightCm: 30, ...overrides };
}

test.before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('GET /api/pricing/options returns UI metadata', async () => {
  const response = await fetch(`${baseUrl}/api/pricing/options`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.materials));
  assert.ok(Array.isArray(body.complexities));
  assert.equal(typeof body.depthThresholdMm, 'number');
});

test('options contains the valid material keys', async () => {
  const body = await (await fetch(`${baseUrl}/api/pricing/options`)).json();
  assert.deepEqual(body.materials.slice().sort(), ['acrylic', 'granite', 'marble', 'sandstone']);
});

test('options contains the valid complexity keys', async () => {
  const body = await (await fetch(`${baseUrl}/api/pricing/options`)).json();
  assert.deepEqual(body.complexities.slice().sort(), ['detailed', 'premium', 'simple', 'standard']);
  assert.equal(body.defaultComplexity, 'standard');
});

test('options never leaks pricing coefficients or paths', async () => {
  const text = await (await fetch(`${baseUrl}/api/pricing/options`)).text();
  for (const secret of [
    'base_per_cm2', 'minutes_per_cm2', 'cnc_rate_per_minute', 'setup_fee',
    'minimum_price', 'paint_per_cm2', 'installation_fee', 'rush_multiplier',
    'complexity_multipliers', 'deep_cut', 'pricing_rules.json', 'C:\\', '/data/'
  ]) {
    assert.equal(text.includes(secret), false, `options leaked ${secret}`);
  }
});

test('POST /api/price returns a deterministic engine result', async () => {
  const response = await priceRequest(validPrice());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.currency, 'THB');
  assert.equal(body.result.material, 'granite');
  assert.equal(body.result.quantity, 1);
  assert.equal(body.result.area_cm2, 600);
});

test('granite 20x30 depth 3 standard quantity 1 stays exactly 1064.40', async () => {
  const body = await (await priceRequest(validPrice({ depthMm: 3, complexity: 'standard', quantity: 1 }))).json();
  assert.equal(body.result.total, 1064.4);
  assert.deepEqual(body.result.breakdown, {
    material: 720, depth: 0, cnc: 194.4, setup: 150, paint: 0, installation: 0
  });
});

test('omitted optional fields use the same defaults as the explicit request', async () => {
  const [implicit, explicit] = await Promise.all([
    (await priceRequest(validPrice())).json(),
    (await priceRequest(validPrice({ depthMm: 3, quantity: 1, complexity: 'standard', rush: false, paint: false, install: false }))).json()
  ]);
  assert.deepEqual(implicit.result, explicit.result);
});

test('depth above the threshold adds a surcharge', async () => {
  const base = await (await priceRequest(validPrice({ depthMm: 3 }))).json();
  const deep = await (await priceRequest(validPrice({ depthMm: 6 }))).json();
  assert.equal(base.result.breakdown.depth, 0);
  assert.ok(deep.result.breakdown.depth > 0);
  assert.ok(deep.result.total > base.result.total);
});

test('paint adds a paint cost only', async () => {
  const base = await (await priceRequest(validPrice())).json();
  const painted = await (await priceRequest(validPrice({ paint: true }))).json();
  assert.equal(base.result.breakdown.paint, 0);
  assert.ok(painted.result.breakdown.paint > 0);
  assert.equal(painted.result.breakdown.material, base.result.breakdown.material);
});

test('install adds an installation fee', async () => {
  const base = await (await priceRequest(validPrice())).json();
  const installed = await (await priceRequest(validPrice({ install: true }))).json();
  assert.equal(base.result.breakdown.installation, 0);
  assert.ok(installed.result.breakdown.installation > 0);
});

test('rush applies the engine rush multiplier', async () => {
  const base = await (await priceRequest(validPrice())).json();
  const rushed = await (await priceRequest(validPrice({ rush: true }))).json();
  assert.equal(base.result.rush_multiplier, 1);
  assert.ok(rushed.result.rush_multiplier > 1);
  assert.ok(rushed.result.total > base.result.total);
});

test('quantity scales the subtotal and is reported back', async () => {
  const single = await (await priceRequest(validPrice({ quantity: 1 }))).json();
  const triple = await (await priceRequest(validPrice({ quantity: 3 }))).json();
  assert.equal(triple.result.quantity, 3);
  // The engine rounds each result to two decimals, so compare against the
  // rounded expectation rather than a raw float product.
  assert.equal(triple.result.subtotal, Math.round(single.result.subtotal * 3 * 100) / 100);
});

test('invalid material returns 400 with a safe message', async () => {
  const response = await priceRequest(validPrice({ material: 'titanium' }));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /material is unknown/);
  assert.equal(body.stack, undefined);
});

test('invalid complexity returns 400', async () => {
  const response = await priceRequest(validPrice({ complexity: 'ultra' }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /complexity is unknown/);
});

test('zero and negative width return 400', async () => {
  for (const widthCm of [0, -5]) {
    const response = await priceRequest(validPrice({ widthCm }));
    assert.equal(response.status, 400, `width ${widthCm}`);
  }
});

test('zero and negative height return 400', async () => {
  for (const heightCm of [0, -5]) {
    const response = await priceRequest(validPrice({ heightCm }));
    assert.equal(response.status, 400, `height ${heightCm}`);
  }
});

test('invalid quantity returns 400 and never renders Infinity', async () => {
  for (const quantity of [0, -1, 1.5, 1e308, '2', null]) {
    const response = await priceRequest(validPrice({ quantity }));
    assert.equal(response.status, 400, `quantity ${quantity}`);
    const text = await response.text();
    assert.equal(text.includes('Infinity'), false);
  }
});

test('an empty body returns 400', async () => {
  const response = await priceRequest({});
  assert.equal(response.status, 400);
});

test('malformed JSON returns 400 without a stack trace', async () => {
  const response = await priceRequest('{"material":', { raw: true });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(typeof body.error, 'string');
  assert.equal(body.error.includes('at '), false);
});

test('oversized bodies are rejected by the 16kb limit', async () => {
  const response = await priceRequest(
    JSON.stringify({ material: 'granite', widthCm: 20, heightCm: 30, note: 'x'.repeat(64 * 1024) }),
    { raw: true }
  );
  assert.ok(response.status >= 400, `expected a client error, got ${response.status}`);
  assert.notEqual(response.status, 200);
});

test('unsupported fields are rejected rather than silently ignored', async () => {
  const response = await priceRequest({ ...validPrice(), photoSizeInches: 2 });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /unsupported field/);
});

test('error messages never expose filesystem paths', async () => {
  for (const body of [validPrice({ material: 'nope' }), validPrice({ widthCm: -1 }), {}]) {
    const text = await (await priceRequest(body)).text();
    assert.doesNotMatch(text, /[A-Za-z]:\\|\/data\/|node_modules|pricing_rules\.json/);
  }
});

test('repeated identical input gives an identical pricing result', async () => {
  const [first, second] = await Promise.all([
    (await priceRequest(validPrice({ depthMm: 6, quantity: 2, paint: true, rush: true }))).json(),
    (await priceRequest(validPrice({ depthMm: 6, quantity: 2, paint: true, rush: true }))).json()
  ]);
  assert.deepEqual(first, second);
});

test('the existing quotation endpoint remains compatible', async () => {
  const response = await fetch(`${baseUrl}/api/quotes/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Test Customer',
      phone: '0800000000',
      jobType: 'Stone sign',
      material: 'granite',
      widthCm: 30,
      heightCm: 20,
      quantity: 1,
      complexity: 'standard',
      rush: false
    })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.quoteNumber, /^QT-\d{8}-\d{6}$/);
  assert.equal(body.result.total, 1064.4);
  // The quotation endpoint still requires customer identity; the pricing
  // calculator deliberately does not.
  const missingCustomer = await fetch(`${baseUrl}/api/quotes/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ material: 'granite', widthCm: 30, heightCm: 20 })
  });
  assert.equal(missingCustomer.status, 400);
});

test('the pricing page is served and asks for no customer information', async () => {
  const response = await fetch(`${baseUrl}/pricing.html`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /\/pricing\.js/);
  for (const name of ['customerName', 'phone', 'chat', 'telegram', 'quoteNumber']) {
    assert.equal(html.toLowerCase().includes(name.toLowerCase()), false, `pricing page references ${name}`);
  }
});
