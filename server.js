const express = require('express');
const path = require('path');
const fs = require('fs');
const { calculateJobPrice } = require('./tools/pricing_engine');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const RULES_PATH = path.join(__dirname, 'data', 'pricing_rules.json');

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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/quotes/preview', (req, res) => {
  try {
    const customer = {
      name: requiredText(req.body.customerName, 'customerName'),
      phone: requiredText(req.body.phone, 'phone')
    };
    const jobType = requiredText(req.body.jobType, 'jobType');
    const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
    const job = {
      id: quoteNumber(),
      description: `${jobType}${notes ? ` — ${notes}` : ''}`,
      material: req.body.material,
      width_cm: req.body.widthCm,
      height_cm: req.body.heightCm,
      quantity: req.body.quantity,
      complexity: req.body.complexity,
      rush: Boolean(req.body.rush),
      depth_mm: 3,
      paint: false,
      install: false
    };
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`OAS quotation app: http://localhost:${PORT}`);
  });
}

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && Object.hasOwn(error, 'body')) {
    return res.status(400).json({ error: 'Invalid JSON request body' });
  }

  return next(error);
});

module.exports = { app };
