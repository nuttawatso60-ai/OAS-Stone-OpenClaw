'use strict';

const fs = require('node:fs');
const path = require('node:path');

// All checks in this module are check-then-use and therefore subject to
// TOCTOU races: the filesystem can change between a check and the operation
// it guards. Callers must treat these as safeguards against mistakes and
// misconfiguration, not as a defense against a concurrent attacker.

function validatePathString(value, name) {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`);
  }
  if (value.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  if (value.includes('\0')) {
    throw new Error(`${name} must not contain null bytes`);
  }
  // Windows device paths (\\?\ and \\.\) bypass normal path normalization
  // and break path.relative-based containment checks, so they are rejected.
  if (/^[\\/][\\/][?.][\\/]/.test(value)) {
    throw new Error(`${name} must not use Windows device path syntax`);
  }
}

function normalizeForComparison(targetPath) {
  validatePathString(targetPath, 'targetPath');
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSamePathOrContained(parentPath, childPath) {
  const parent = normalizeForComparison(parentPath);
  const child = normalizeForComparison(childPath);
  if (parent === child) {
    return true;
  }

  const relative = path.relative(parent, child);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function resolveInside(baseDir, relativePath) {
  validatePathString(baseDir, 'baseDir');
  validatePathString(relativePath, 'relativePath');

  // path.win32.isAbsolute recognizes both Windows ("C:\\x", "\\\\srv\\share")
  // and POSIX ("/x") absolute forms, so Windows-style absolute paths are
  // rejected even when running on a POSIX platform.
  if (path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath)) {
    throw new Error('relativePath must not be absolute');
  }

  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, relativePath);

  if (!isSamePathOrContained(base, resolved)) {
    throw new Error('resolved path escapes baseDir');
  }

  return resolved;
}

function assertOutside(targetPath, forbiddenDirs) {
  validatePathString(targetPath, 'targetPath');
  if (!Array.isArray(forbiddenDirs)) {
    throw new TypeError('forbiddenDirs must be an array');
  }

  for (const forbiddenDir of forbiddenDirs) {
    validatePathString(forbiddenDir, 'forbiddenDir');
    if (isSamePathOrContained(forbiddenDir, targetPath)) {
      throw new Error('targetPath is inside a forbidden directory');
    }
  }

  return path.resolve(targetPath);
}

function lstatIfExists(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// A non-existent final target is allowed (the common create-new-file case).
// Every ancestor is lstat-ed directly rather than located via fs.existsSync,
// because existsSync follows links and reports false for a broken symlink,
// which would let a broken symlink ancestor pass unnoticed.
function assertNoSymlink(targetPath, options = {}) {
  validatePathString(targetPath, 'targetPath');
  const { checkAncestors = false } = options;
  const resolved = path.resolve(targetPath);

  const stats = lstatIfExists(resolved);
  if (stats !== null && stats.isSymbolicLink()) {
    throw new Error('targetPath must not be a symlink');
  }

  if (checkAncestors) {
    let current = resolved;
    while (true) {
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
      const ancestorStats = lstatIfExists(current);
      if (ancestorStats !== null && ancestorStats.isSymbolicLink()) {
        throw new Error('targetPath ancestor must not be a symlink');
      }
    }
  }

  return resolved;
}

module.exports = {
  normalizeForComparison,
  isSamePathOrContained,
  resolveInside,
  assertOutside,
  assertNoSymlink
};
