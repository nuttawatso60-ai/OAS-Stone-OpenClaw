#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const WORKSPACE_DIR = path.resolve(__dirname, '..');
const DEFAULT_RULES_FILE = path.join(WORKSPACE_DIR, 'data', 'pricing_rules.json');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON file: ${filePath}\n${error.message}`);
  }
}

function toNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }
  return number;
}

function toPositiveNumber(value, fieldName) {
  const number = toNumber(value, fieldName);
  if (number <= 0) {
    throw new Error(`${fieldName} must be greater than 0`);
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateJobPrice(job, rules) {
  const id = requireText(job.id, 'job.id');
  const materialName = requireText(job.material, `job ${id}.material`);
  const material = rules.materials[materialName];
  if (!material) {
    throw new Error(`job ${id}.material is unknown: ${materialName}`);
  }

  const widthCm = toPositiveNumber(job.width_cm, `job ${id}.width_cm`);
  const heightCm = toPositiveNumber(job.height_cm, `job ${id}.height_cm`);
  const depthMm = toNumber(job.depth_mm, `job ${id}.depth_mm`);
  const quantity = Math.floor(toPositiveNumber(job.quantity ?? 1, `job ${id}.quantity`));
  const complexityName = requireText(job.complexity ?? 'standard', `job ${id}.complexity`);
  const complexityMultiplier = rules.complexity_multipliers[complexityName];
  if (!complexityMultiplier) {
    throw new Error(`job ${id}.complexity is unknown: ${complexityName}`);
  }

  const areaCm2 = widthCm * heightCm;
  const baseMaterialCost = areaCm2 * material.base_per_cm2;
  const depthExtraMm = Math.max(0, depthMm - rules.depth_threshold_mm);
  const depthCost = areaCm2 * depthExtraMm * rules.deep_cut_extra_per_cm2_per_mm;
  const depthFactor = 1 + depthExtraMm * rules.deep_cut_time_factor_per_mm;
  const cncMinutes = areaCm2 * material.minutes_per_cm2 * complexityMultiplier * depthFactor;
  const cncCost = cncMinutes * rules.cnc_rate_per_minute;
  const setupCost = rules.setup_fee;
  const paintingCost = job.paint ? areaCm2 * rules.paint_per_cm2 : 0;
  const installationCost = job.install ? rules.installation_fee : 0;

  const subtotalPerUnit = baseMaterialCost + depthCost + cncCost + setupCost + paintingCost + installationCost;
  const quantitySubtotal = subtotalPerUnit * quantity;
  const rushMultiplier = job.rush ? rules.rush_multiplier : 1;
  const beforeMinimum = quantitySubtotal * rushMultiplier;
  const total = Math.max(beforeMinimum, rules.minimum_price);

  return {
    id,
    description: job.description || '',
    material: materialName,
    quantity,
    area_cm2: roundMoney(areaCm2),
    cnc_minutes: roundMoney(cncMinutes * quantity),
    subtotal: roundMoney(quantitySubtotal),
    rush_multiplier: rushMultiplier,
    total: roundMoney(total),
    breakdown: {
      material: roundMoney(baseMaterialCost * quantity),
      depth: roundMoney(depthCost * quantity),
      cnc: roundMoney(cncCost * quantity),
      setup: roundMoney(setupCost * quantity),
      paint: roundMoney(paintingCost * quantity),
      installation: roundMoney(installationCost * quantity)
    }
  };
}

function calculateJobs(jobs, rules) {
  if (!Array.isArray(jobs)) {
    throw new Error('sample jobs file must contain a JSON array');
  }
  return jobs.map(job => calculateJobPrice(job, rules));
}

function printResults(results, currency) {
  const rows = results.map(result => ({
    id: result.id,
    material: result.material,
    qty: result.quantity,
    area_cm2: result.area_cm2,
    cnc_min: result.cnc_minutes,
    total_thb: result.total
  }));

  console.table(rows);
  const grandTotal = results.reduce((sum, result) => sum + result.total, 0);
  console.log(`Grand total: ${roundMoney(grandTotal)} ${currency}`);
  console.log(JSON.stringify({ jobs: results, grand_total: roundMoney(grandTotal), currency }, null, 2));
}

function usage() {
  console.log(`Pricing Engine v0.1

Usage:
  node pricing_engine.js calculate [jobsFile] [rulesFile]
  node pricing_engine.js [jobsFile]

Defaults:
  jobsFile  sample_jobs.json
  rulesFile pricing_rules.json
`);
}

function main(argv) {
  const command = argv[2];
  if (!command || command === '--help' || command === '-h') {
    usage();
    return 0;
  }

  const isCalculate = command === 'calculate';
  const jobsFile = path.resolve(isCalculate ? (argv[3] || 'sample_jobs.json') : command);
  const rulesFile = path.resolve(isCalculate ? (argv[4] || DEFAULT_RULES_FILE) : (argv[3] || DEFAULT_RULES_FILE));
  const jobs = readJson(jobsFile);
  const rules = readJson(rulesFile);
  const results = calculateJobs(jobs, rules);
  printResults(results, rules.currency || 'THB');
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (error) {
    console.error(`Pricing Engine error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { calculateJobPrice, calculateJobs };
