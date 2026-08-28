'use strict';

const {
  ValidationError,
  UnknownStatusError,
  PersistenceError
} = require('./job_errors');

const BANGKOK_UTC_OFFSET = '+7 hours';
const STATUSES = Object.freeze(['รอผลิต', 'กำลังผลิต', 'เสร็จแล้ว', 'ส่งแล้ว']);
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

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

function parseDate(value, field) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new ValidationError(`${field} must be a canonical YYYY-MM-DD date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`${field} must be a real calendar date`);
  }
  return parsed;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function reportTotals(db, column, startDate, endDate, status) {
  const statusClause = status === undefined ? '' : ' AND status = ?';
  const parameters = status === undefined
    ? [startDate, endDate]
    : [startDate, endDate, status];
  const row = db.prepare(`
    SELECT COUNT(*) AS job_count, COALESCE(SUM(total_satang), 0) AS total_satang
    FROM jobs
    WHERE date(${column}, '${BANGKOK_UTC_OFFSET}') >= ?
      AND date(${column}, '${BANGKOK_UTC_OFFSET}') < ?
      ${statusClause}
  `).get(...parameters);
  return {
    jobCount: row.job_count,
    totalSatang: row.total_satang
  };
}

function dailyTotals(db, column, date, status) {
  const nextDate = formatDate(addDays(date, 1));
  return reportTotals(db, column, formatDate(date), nextDate, status);
}

function weeklyTotals(db, column, weekStart, status) {
  const startDate = formatDate(weekStart);
  const nextMonday = formatDate(addDays(weekStart, 7));
  return reportTotals(db, column, startDate, nextMonday, status);
}

function wrapPersistence(operation) {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ValidationError || error instanceof UnknownStatusError) {
      throw error;
    }
    throw new PersistenceError('job reporting unavailable');
  }
}

function createJobReports({ db } = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new ValidationError('db is required');
  }

  return {
    getStatusCounts() {
      return wrapPersistence(() => {
        const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
        let openValueSatang = 0;
        let deliveredValueSatang = 0;
        const rows = db.prepare(`
          SELECT status, COUNT(*) AS job_count, COALESCE(SUM(total_satang), 0) AS total_satang
          FROM jobs
          GROUP BY status
        `).all();
        for (const row of rows) {
          if (!Object.hasOwn(counts, row.status)) continue;
          counts[row.status] = row.job_count;
          if (row.status === 'ส่งแล้ว') {
            deliveredValueSatang = row.total_satang;
          } else {
            openValueSatang += row.total_satang;
          }
        }
        return {
          counts,
          totalJobs: Object.values(counts).reduce((sum, count) => sum + count, 0),
          openValueSatang,
          deliveredValueSatang,
          currency: 'THB'
        };
      });
    },

    listQueue({ status } = {}) {
      return wrapPersistence(() => {
        const normalizedStatus = status === undefined ? undefined : normalizeStatus(status);
        const rows = normalizedStatus === undefined
          ? db.prepare('SELECT * FROM jobs ORDER BY job_id ASC').all()
          : db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY job_id ASC').all(normalizedStatus);
        return rows.map(row => ({
          jobId: row.job_id,
          status: row.status,
          quoteNumber: row.quote_number,
          customerName: row.customer_name,
          jobType: row.job_type,
          material: row.material,
          widthCm: row.width_cm,
          heightCm: row.height_cm,
          quantity: row.quantity,
          rush: Boolean(row.rush),
          totalSatang: row.total_satang,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }));
      });
    },

    getDailyReport({ date } = {}) {
      return wrapPersistence(() => {
        const parsedDate = parseDate(date, 'date');
        return {
          date: formatDate(parsedDate),
          timezone: 'Asia/Bangkok',
          created: dailyTotals(db, 'created_at', parsedDate),
          delivered: dailyTotals(db, 'updated_at', parsedDate, 'ส่งแล้ว'),
          currency: 'THB'
        };
      });
    },

    getWeeklyReport({ weekStart } = {}) {
      return wrapPersistence(() => {
        const parsedStart = parseDate(weekStart, 'weekStart');
        if (parsedStart.getUTCDay() !== 1) {
          throw new ValidationError('weekStart must be a Monday');
        }
        return {
          weekStart: formatDate(parsedStart),
          weekEnd: formatDate(addDays(parsedStart, 6)),
          timezone: 'Asia/Bangkok',
          created: weeklyTotals(db, 'created_at', parsedStart),
          delivered: weeklyTotals(db, 'updated_at', parsedStart, 'ส่งแล้ว'),
          currency: 'THB'
        };
      });
    }
  };
}

module.exports = {
  BANGKOK_UTC_OFFSET,
  createJobReports
};
