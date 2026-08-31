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

// Anything that reaches Express's default error handler is rendered as HTML
// with a stack trace and absolute filesystem paths, so every error response is
// checked for leakage, not just for its status code.
const LEAK_PATTERNS = [
  /PayloadTooLargeError/,
  /Error:/,
  /node_modules/,
  /[A-Za-z]:\\/,
  /OAS-Stone-OpenClaw/,
  /at readStream/,
  /\bat [A-Za-z_$][\w$]*\s*\(/,
  /<html/i,
  /<pre>/i
];

function assertNoLeak(text, label) {
  for (const pattern of LEAK_PATTERNS) {
    assert.doesNotMatch(text, pattern, `${label} leaked ${pattern}`);
  }
}

test('oversized bodies are rejected by the 16kb limit as safe JSON', async () => {
  const response = await priceRequest(
    JSON.stringify({ material: 'granite', widthCm: 20, heightCm: 30, note: 'x'.repeat(64 * 1024) }),
    { raw: true }
  );
  assert.equal(response.status, 413);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { error: 'Request body is too large' });
  assertNoLeak(text, 'oversized body response');
});

test('the oversized-body response never echoes the payload back', async () => {
  const marker = 'MARKER-do-not-reflect';
  const response = await priceRequest(
    JSON.stringify({ material: 'granite', widthCm: 20, heightCm: 30, note: `${marker}${'x'.repeat(64 * 1024)}` }),
    { raw: true }
  );
  assert.equal(response.status, 413);
  const text = await response.text();
  assert.equal(text.includes(marker), false, 'oversized response reflected the payload');
});

test('malformed JSON stays a safe 400 with no stack or path', async () => {
  const response = await priceRequest('{"material":', { raw: true });
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { error: 'Invalid JSON request body' });
  assertNoLeak(text, 'malformed JSON response');
});

test('an unexpected middleware failure becomes a generic JSON 500, not an HTML stack', async () => {
  // A corrupt gzip body makes body-parser fail with something that is neither a
  // JSON syntax error nor a size error, so it exercises the final fallback.
  const response = await fetch(`${baseUrl}/api/price`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    body: 'this-is-not-gzip-data'
  });
  assert.equal(response.status, 500);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { error: 'Internal server error' });
  assertNoLeak(text, 'unexpected middleware failure response');
});

test('unsupported fields are rejected rather than silently ignored', async () => {
  const response = await priceRequest({ ...validPrice(), photoSizeInches: 2 });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /unsupported field/);
});

test('boolean dimensions are rejected instead of silently coerced', async () => {
  for (const field of ['widthCm', 'heightCm', 'depthMm']) {
    const response = await priceRequest(validPrice({ [field]: true }));
    assert.equal(response.status, 400, field);
    assert.match((await response.json()).error, /must be a finite number/);
  }
});

test('string dimensions are rejected instead of silently coerced', async () => {
  const response = await priceRequest(validPrice({ widthCm: '20' }));
  assert.equal(response.status, 400);
});

test('reflected error messages are capped so a large body is not echoed back', async () => {
  const response = await priceRequest(validPrice({ material: 'x'.repeat(4000) }));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(body.error.length <= 210, `error message was ${body.error.length} characters`);
});

test('a structurally broken rules file returns 500, never a 400 or a NaN price', async () => {
  // Exercised through createApp so the real endpoint wiring is under test.
  const { createApp } = require('../server');
  const fs = require('node:fs');
  const originalReadFileSync = fs.readFileSync;
  const brokenApp = createApp();
  const brokenServer = http.createServer(brokenApp);
  await new Promise(resolve => brokenServer.listen(0, '127.0.0.1', resolve));
  const brokenUrl = `http://127.0.0.1:${brokenServer.address().port}/api/price`;

  const call = async () => {
    const response = await fetch(brokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validPrice())
    });
    return { status: response.status, body: await response.json() };
  };

  try {
    // Missing materials entirely: the engine throws a TypeError.
    fs.readFileSync = (file, ...rest) => String(file).endsWith('pricing_rules.json')
      ? '{}'
      : originalReadFileSync(file, ...rest);
    const missing = await call();
    assert.equal(missing.status, 500);
    assert.equal(missing.body.error, 'Pricing is temporarily unavailable');
    assert.doesNotMatch(missing.body.error, /Cannot read properties|undefined/);

    // Present but incomplete: the engine returns NaN instead of throwing.
    fs.readFileSync = (file, ...rest) => String(file).endsWith('pricing_rules.json')
      ? JSON.stringify({ materials: { granite: { base_per_cm2: 1 } }, complexity_multipliers: { standard: 1 } })
      : originalReadFileSync(file, ...rest);
    const incomplete = await call();
    assert.equal(incomplete.status, 500);
    assert.equal(incomplete.body.error, 'Pricing is temporarily unavailable');
  } finally {
    fs.readFileSync = originalReadFileSync;
    await new Promise((resolve, reject) => brokenServer.close(error => error ? reject(error) : resolve()));
  }
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
