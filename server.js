const express = require('express');
const path = require('path');
const fs = require('fs');
const { calculateJobPrice } = require('./tools/pricing_engine');
const {
  createJobStore,
  InvalidTransitionError,
  JobNotFoundError,
  PersistenceError,
  UnknownStatusError,
  ValidationError
} = require('./tools/job_store');

const PORT = Number(process.env.PORT) || 3000;
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

function createApp({ jobStore } = {}) {
  const app = express();
  let runtimeJobStore = jobStore;
  const getJobStore = () => {
    runtimeJobStore ??= createJobStore({ dbPath: DB_PATH });
    return runtimeJobStore;
  };

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

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
  app.listen(PORT, () => {
    console.log(`OAS quotation app: http://localhost:${PORT}`);
  });
}

module.exports = { app, createApp };
