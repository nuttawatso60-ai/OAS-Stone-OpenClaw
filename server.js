const express = require('express');
const path = require('path');
const fs = require('fs');
const { calculateJobPrice } = require('./tools/pricing_engine');
const {
  createJobStore
} = require('./tools/job_store');
const {
  InvalidTransitionError,
  JobNotFoundError,
  PersistenceError,
  UnknownStatusError,
  ValidationError
} = require('./tools/job_errors');

const PORT = Number(process.env.PORT) || 3000;
// Default stays loopback-only. LAN access is an explicit opt-in via HOST, and
// there is no authentication yet, so only use it on a trusted private network.
const HOST = process.env.HOST || '127.0.0.1';
const JSON_BODY_LIMIT = '16kb';
const RULES_PATH = path.join(__dirname, 'data', 'pricing_rules.json');
const DB_PATH = path.join(__dirname, 'data', 'jobs.db');

function loadRules() {
  return JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
}

function quoteNumber(now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `QT-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function requiredText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function buildJobRequest(body) {
  const customer = {
    name: requiredText(body.customerName, 'customerName'),
    phone: requiredText(body.phone, 'phone')
  };
  const jobType = requiredText(body.jobType, 'jobType');
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  const job = {
    id: quoteNumber(),
    description: `${jobType}${notes ? ` — ${notes}` : ''}`,
    material: body.material,
    width_cm: body.widthCm,
    height_cm: body.heightCm,
    quantity: body.quantity,
    complexity: body.complexity,
    rush: Boolean(body.rush),
    depth_mm: 3,
    paint: false,
    install: false
  };
  return {
    customer,
    job,
    jobType,
    notes
  };
}

// The pricing calculator is a pure calculator: no customer identity, no
// quotation metadata. It maps a browser request onto the exact structure that
// the existing deterministic pricing engine already accepts.
function buildPriceRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new PriceInputError('request body must be a JSON object');
  }
  const allowed = new Set([
    'material', 'widthCm', 'heightCm', 'depthMm',
    'quantity', 'complexity', 'rush', 'paint', 'install'
  ]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new PriceInputError(`unsupported field: ${key}`);
  }
  for (const key of ['rush', 'paint', 'install']) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      throw new PriceInputError(`${key} must be a boolean`);
    }
  }
  if (body.quantity !== undefined && !Number.isSafeInteger(body.quantity)) {
    throw new PriceInputError('quantity must be a positive integer');
  }
  // The engine coerces with Number(), so a boolean would silently price as 1 cm.
  // The documented contract is a number, so require one here.
  for (const key of ['widthCm', 'heightCm', 'depthMm']) {
    if (body[key] !== undefined && (typeof body[key] !== 'number' || !Number.isFinite(body[key]))) {
      throw new PriceInputError(`${key} must be a finite number`);
    }
  }

  return {
    id: 'PRICE',
    description: '',
    material: body.material,
    width_cm: body.widthCm,
    height_cm: body.heightCm,
    // The engine requires depth_mm; 3 mm matches the assumption the existing
    // quotation flow already uses.
    depth_mm: body.depthMm === undefined ? 3 : body.depthMm,
    quantity: body.quantity === undefined ? 1 : body.quantity,
    complexity: body.complexity === undefined ? 'standard' : body.complexity,
    rush: body.rush === true,
    paint: body.paint === true,
    install: body.install === true
  };
}

// Only safe UI metadata: the browser needs valid choices, never the private
// coefficients behind them.
function buildPricingOptions(rules) {
  return {
    materials: Object.keys(rules.materials),
    complexities: Object.keys(rules.complexity_multipliers),
    depthThresholdMm: rules.depth_threshold_mm,
    defaultComplexity: 'standard',
    defaultDepthMm: 3,
    currency: rules.currency || 'THB'
  };
}

function jobErrorResponse(error, res) {
  if (error instanceof ValidationError || error instanceof UnknownStatusError) {
    return res.status(400).json({ error: error.message });
  }
  if (error instanceof JobNotFoundError) {
    return res.status(404).json({ error: error.message });
  }
  if (error instanceof InvalidTransitionError) {
    return res.status(409).json({ error: error.message });
  }
  if (error instanceof PersistenceError) {
    return res.status(503).json({ error: 'Job persistence unavailable' });
  }
  return res.status(400).json({ error: error.message });
}

class PriceInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PriceInputError';
  }
}

// Strips the internal "job PRICE." prefix the engine uses and refuses to pass
// through anything that looks like a filesystem path or a stack trace. Engine
// validation messages embed the offending value, so the result is also capped
// to stop a large request body from being reflected back verbatim.
const MAX_ERROR_MESSAGE_LENGTH = 200;

function safeMessage(error) {
  const raw = typeof error?.message === 'string' ? error.message : '';
  const message = raw.replace(/^job PRICE\./, '').trim();
  if (message === '' || /[\r\n\\/]/.test(message)) {
    return 'invalid pricing input';
  }
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : message;
}

// The engine reports input problems with a plain Error. Anything else — a
// TypeError from structurally broken rules, for example — is a server fault,
// not a client mistake, and must not be reported as a 400 or leak its message.
function isEngineValidationError(error) {
  return error instanceof Error && error.constructor === Error;
}

function createApp({ jobStore } = {}) {
  const app = express();
  let runtimeJobStore = jobStore;
  const getJobStore = () => {
    runtimeJobStore ??= createJobStore({ dbPath: DB_PATH });
    return runtimeJobStore;
  };

  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/pricing/options', (req, res) => {
    try {
      return res.json(buildPricingOptions(loadRules()));
    } catch (error) {
      return res.status(500).json({ error: 'Pricing options unavailable' });
    }
  });

  app.post('/api/price', (req, res) => {
    let job;
    try {
      job = buildPriceRequest(req.body);
    } catch (error) {
      return res.status(400).json({ error: safeMessage(error) });
    }

    let rules;
    try {
      rules = loadRules();
    } catch (error) {
      return res.status(500).json({ error: 'Pricing is temporarily unavailable' });
    }

    try {
      const result = calculateJobPrice(job, rules);
      // A structurally incomplete rules file can produce NaN instead of
      // throwing. Never hand the browser a price that is not a real number.
      if (!Number.isFinite(result.total)) {
        return res.status(500).json({ error: 'Pricing is temporarily unavailable' });
      }
      return res.json({ currency: 'THB', result });
    } catch (error) {
      // Engine validation messages are safe field-level text, but they are
      // normalised here so no path or stack ever reaches the client.
      if (!isEngineValidationError(error)) {
        return res.status(500).json({ error: 'Pricing is temporarily unavailable' });
      }
      return res.status(400).json({ error: safeMessage(error) });
    }
  });

  app.post('/api/quotes/preview', (req, res) => {
    try {
      const { customer, job, jobType, notes } = buildJobRequest(req.body);
      const result = calculateJobPrice(job, loadRules());

      res.json({
        shopName: 'อ.เอ.เอส แกะสลัก',
        quoteNumber: job.id,
        createdAt: new Date().toLocaleString('th-TH'),
        customer,
        job: { ...job, jobType, notes },
        result,
        currency: 'THB'
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/jobs', (req, res) => {
    try {
      const { customer, job, jobType, notes } = buildJobRequest(req.body);
      const result = calculateJobPrice(job, loadRules());
      const persisted = getJobStore().createJob({
        customer,
        job: {
          jobType,
          notes,
          material: job.material,
          widthCm: job.width_cm,
          heightCm: job.height_cm,
          depthMm: job.depth_mm,
          quantity: result.quantity,
          complexity: job.complexity || 'standard',
          rush: job.rush,
          paint: job.paint,
          install: job.install
        },
        result,
        quoteNumber: job.id
      });
      return res.status(201).json(persisted);
    } catch (error) {
      return jobErrorResponse(error, res);
    }
  });

  app.get('/api/jobs', (req, res) => {
    try {
      const status = req.query.status;
      return res.json(getJobStore().listJobs(status === undefined ? {} : { status }));
    } catch (error) {
      return jobErrorResponse(error, res);
    }
  });

  app.get('/api/jobs/:jobId', (req, res) => {
    try {
      return res.json(getJobStore().getJob(req.params.jobId));
    } catch (error) {
      return jobErrorResponse(error, res);
    }
  });

  app.patch('/api/jobs/:jobId/status', (req, res) => {
    try {
      return res.json(getJobStore().updateStatus(req.params.jobId, req.body.status));
    } catch (error) {
      return jobErrorResponse(error, res);
    }
  });

  app.get('/api/ops/summary', (req, res) => {
    try {
      return res.json(getJobStore().reports.getStatusCounts());
    } catch (error) {
      return jobErrorResponse(error, res);
    }
  });

  app.get('/api/ops/queue', (req, res) => {
    try {
      const status = req.query.status;
      return res.json(getJobStore().reports.listQueue(status === undefined ? {} : { status }));
    } catch (error) {
      return jobErrorResponse(error, res);
    }
  });

  app.get('/api/ops/reports/daily', (req, res) => {
    try {
      return res.json(getJobStore().reports.getDailyReport({ date: req.query.date }));
    } catch (error) {
      return jobErrorResponse(error, res);
    }
  });

  app.get('/api/ops/reports/weekly', (req, res) => {
    try {
      return res.json(getJobStore().reports.getWeeklyReport({ weekStart: req.query.weekStart }));
    } catch (error) {
      return jobErrorResponse(error, res);
    }
  });

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && Object.hasOwn(error, 'body')) {
      return res.status(400).json({ error: 'Invalid JSON request body' });
    }

    return next(error);
  });

  return app;
}

const app = createApp();

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`OAS pricing app: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    if (HOST === '0.0.0.0') {
      console.log('LAN mode is enabled and has no authentication. Use a trusted private network only.');
    }
  });
}

module.exports = { app, createApp };
