'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { assertNoSymlink } = require('../scripts/lib/extraction/path_safety');

const SUPPORTED_SCHEMA_VERSION = 1;
const STATUSES = Object.freeze(['รอผลิต', 'กำลังผลิต', 'เสร็จแล้ว', 'ส่งแล้ว']);
const STATUS_TRANSITIONS = Object.freeze({
  'รอผลิต': 'กำลังผลิต',
  'กำลังผลิต': 'เสร็จแล้ว',
  'เสร็จแล้ว': 'ส่งแล้ว'
});

class JobStoreError extends Error {}
class ValidationError extends JobStoreError {}
class UnknownStatusError extends JobStoreError {}
class JobNotFoundError extends JobStoreError {}
class InvalidTransitionError extends JobStoreError {}
class PersistenceError extends JobStoreError {}

function normalizeStatus(value) {
  if (typeof value !== 'string') {
    throw new UnknownStatusError('status is unknown');
  }
  const status = value.normalize('NFC');
  if (!STATUSES.includes(status)) {
    throw new UnknownStatusError('status is unknown');
  }
  return status;
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`);
  }
  return value.trim();
}

function requireFiniteNumber(value, field, { positive = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    throw new ValidationError(`${field} must be ${positive ? 'greater than 0' : 'a non-negative number'}`);
  }
  return value;
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError(`${field} must be a positive safe integer`);
  }
  return value;
}

function requireBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${field} must be a boolean`);
  }
  return value ? 1 : 0;
}

function parseJobId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    throw new ValidationError('jobId must be a canonical positive safe integer');
  }
  const jobId = Number(value);
  if (!Number.isSafeInteger(jobId)) {
    throw new ValidationError('jobId must be a canonical positive safe integer');
  }
  return jobId;
}

function nowUtc() {
  return new Date().toISOString();
}

function hasTraversalSegment(value) {
  return value.split(/[\\/]/).includes('..');
}

function schemaSql() {
  return `
    CREATE TABLE IF NOT EXISTS jobs (
      job_id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'รอผลิต',
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      job_type TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      material TEXT NOT NULL,
      width_cm REAL NOT NULL CHECK (width_cm > 0),
      height_cm REAL NOT NULL CHECK (height_cm > 0),
      depth_mm REAL NOT NULL CHECK (depth_mm >= 0),
      quantity INTEGER NOT NULL CHECK (quantity >= 1),
      complexity TEXT NOT NULL,
      rush INTEGER NOT NULL CHECK (rush IN (0, 1)),
      paint INTEGER NOT NULL CHECK (paint IN (0, 1)),
      install INTEGER NOT NULL CHECK (install IN (0, 1)),
      total_satang INTEGER NOT NULL CHECK (total_satang >= 0),
      currency TEXT NOT NULL DEFAULT 'THB',
      pricing_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (status IN ('รอผลิต', 'กำลังผลิต', 'เสร็จแล้ว', 'ส่งแล้ว'))
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_id ON jobs(status, job_id);
  `;
}

function hydrateRow(row) {
  if (!row) return null;
  let pricingSnapshot;
  try {
    pricingSnapshot = JSON.parse(row.pricing_snapshot);
  } catch {
    throw new PersistenceError('stored pricing snapshot is invalid');
  }
  return {
    job_id: row.job_id,
    quote_number: row.quote_number,
    status: row.status,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    job_type: row.job_type,
    notes: row.notes,
    material: row.material,
    width_cm: row.width_cm,
    height_cm: row.height_cm,
    depth_mm: row.depth_mm,
    quantity: row.quantity,
    complexity: row.complexity,
    rush: Boolean(row.rush),
    paint: Boolean(row.paint),
    install: Boolean(row.install),
    total_satang: row.total_satang,
    currency: row.currency,
    pricing_snapshot: pricingSnapshot,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function wrapPersistence(operation) {
  try {
    return operation();
  } catch (error) {
    if (error instanceof JobStoreError) throw error;
    throw new PersistenceError('job persistence failed');
  }
}

function createJobStore({ dbPath } = {}) {
  if (typeof dbPath !== 'string' || dbPath.length === 0) {
    throw new ValidationError('dbPath must be a non-empty string');
  }
  if (hasTraversalSegment(dbPath)) {
    throw new ValidationError('dbPath must not contain traversal segments');
  }

  let resolvedPath;
  try {
    resolvedPath = dbPath === ':memory:'
      ? dbPath
      : assertNoSymlink(path.resolve(dbPath), { checkAncestors: true });
  } catch {
    throw new ValidationError('dbPath is unsafe');
  }
  let db;

  try {
    db = new DatabaseSync(resolvedPath);
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > SUPPORTED_SCHEMA_VERSION) {
      throw new PersistenceError('job database schema version is newer than supported');
    }
    if (version === 0) {
      db.exec(schemaSql());
      db.exec(`PRAGMA user_version = ${SUPPORTED_SCHEMA_VERSION}`);
    }
  } catch (error) {
    try {
      db?.close();
    } catch {
      // Preserve the original initialization failure.
    }
    if (error instanceof JobStoreError) throw error;
    throw new PersistenceError('job database could not be opened');
  }

  let closed = false;
  const withOpenDb = operation => {
    if (closed) throw new PersistenceError('job store is closed');
    return wrapPersistence(operation);
  };

  return {
    createJob({ customer, job, result, quoteNumber } = {}) {
      return withOpenDb(() => {
        const customerName = requireText(customer?.name, 'customer.name');
        const customerPhone = requireText(customer?.phone, 'customer.phone');
        const normalizedQuoteNumber = requireText(quoteNumber, 'quoteNumber');
        const jobType = requireText(job?.jobType, 'job.jobType');
        const notes = typeof job?.notes === 'string' ? job.notes.trim() : '';
        const material = requireText(job?.material, 'job.material');
        const widthCm = requireFiniteNumber(job?.widthCm, 'job.widthCm', { positive: true });
        const heightCm = requireFiniteNumber(job?.heightCm, 'job.heightCm', { positive: true });
        const depthMm = requireFiniteNumber(job?.depthMm, 'job.depthMm');
        const quantity = requirePositiveInteger(job?.quantity, 'job.quantity');
        const complexity = requireText(job?.complexity, 'job.complexity');
        const rush = requireBoolean(job?.rush, 'job.rush');
        const paint = requireBoolean(job?.paint, 'job.paint');
        const install = requireBoolean(job?.install, 'job.install');
        const total = requireFiniteNumber(result?.total, 'result.total');
        const totalSatang = Math.round(total * 100);
        if (!Number.isSafeInteger(totalSatang)) {
          throw new ValidationError('result.total is too large');
        }
        const pricingSnapshot = JSON.stringify(result);
        const timestamp = nowUtc();
        const statement = db.prepare(`
          INSERT INTO jobs (
            quote_number, customer_name, customer_phone, job_type, notes, material,
            width_cm, height_cm, depth_mm, quantity, complexity, rush, paint, install,
            total_satang, pricing_snapshot, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const inserted = statement.run(
          normalizedQuoteNumber, customerName, customerPhone, jobType, notes, material,
          widthCm, heightCm, depthMm, quantity, complexity, rush, paint, install,
          totalSatang, pricingSnapshot, timestamp, timestamp
        );
        return hydrateRow(db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(inserted.lastInsertRowid));
      });
    },

    getJob(jobId) {
      return withOpenDb(() => {
        const row = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(parseJobId(jobId));
        if (!row) throw new JobNotFoundError('job not found');
        return hydrateRow(row);
      });
    },

    listJobs({ status } = {}) {
      return withOpenDb(() => {
        const normalizedStatus = status === undefined ? undefined : normalizeStatus(status);
        const rows = normalizedStatus === undefined
          ? db.prepare('SELECT * FROM jobs ORDER BY job_id ASC').all()
          : db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY job_id ASC').all(normalizedStatus);
        return rows.map(hydrateRow);
      });
    },

    updateStatus(jobId, nextStatus) {
      return withOpenDb(() => {
        const id = parseJobId(jobId);
        const next = normalizeStatus(nextStatus);
        const current = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(id);
        if (!current) throw new JobNotFoundError('job not found');
        if (current.status === next) return hydrateRow(current);
        if (STATUS_TRANSITIONS[current.status] !== next) {
          throw new InvalidTransitionError('invalid job status transition');
        }
        const timestamp = nowUtc();
        const changed = db.prepare(`
          UPDATE jobs
          SET status = ?, updated_at = ?
          WHERE job_id = ? AND status = ?
        `).run(next, timestamp, id, current.status);
        if (changed.changes === 0) {
          const latest = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(id);
          if (!latest) throw new JobNotFoundError('job not found');
          throw new InvalidTransitionError('invalid job status transition');
        }
        return hydrateRow(db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(id));
      });
    },

    close() {
      if (!closed) {
        db.close();
        closed = true;
      }
    }
  };
}

module.exports = {
  STATUS_TRANSITIONS,
  STATUSES,
  createJobStore,
  ValidationError,
  UnknownStatusError,
  JobNotFoundError,
  InvalidTransitionError,
  PersistenceError
};
