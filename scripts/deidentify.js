#!/usr/bin/env node

// Knowledge Pipeline v2 de-identification stage.
//
// Formatting guarantees:
// - Files are read and written as UTF-8; Thai text is preserved byte-for-byte
//   outside of redacted spans.
// - Original line endings (LF or CRLF) and blank lines are preserved: no
//   pattern consumes or inserts newline characters.
// - Line ordering is never changed; redaction is a pure per-span substitution.
//
// Safety guarantees:
// - Never modifies files under the raw input directory.
// - Refuses to overwrite existing processed files.
// - Refuses to run when input and output directories resolve to the same path
//   or one contains the other; comparisons resolve "." and ".." and are
//   case-insensitive on Windows.
// - Refuses to write output anywhere inside the workspace knowledge/raw/.
// - Symbolic links (files and directories) are rejected, never followed.
// - Only .txt files are processed; output paths are validated to stay inside
//   the processed directory, re-checked against the real (symlink-resolved)
//   parent directory before each write.

const fs = require('fs');
const path = require('path');

const WORKSPACE_DIR = path.resolve(__dirname, '..');
const DEFAULT_RAW_DIR = path.join(WORKSPACE_DIR, 'knowledge', 'raw');
const DEFAULT_PROCESSED_DIR = path.join(WORKSPACE_DIR, 'knowledge', 'processed');

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?<!\d)(?:\+66[ \t-]?(?:\d[ \t-]?){8,9}|0\d{1,2}[ \t-]?\d{3,4}[ \t-]?\d{3,4})(?!\d)/g;
const LINE_ID_PATTERN = /((?:LINE|Line|line|ไลน์)[ \t]*(?:ID|Id|id|ไอดี)?[ \t]*[:：][ \t]*)@?[A-Za-z0-9._-]{3,}/g;
const ADDRESS_PATTERN = /((?:ที่อยู่|ที่จัดส่ง|ส่งที่)[ \t]*[:：][ \t]*)[^\r\n]+/g;
const THAI_NAME_PATTERN = /((?:ชื่อ(?:จริง)?|ผู้ติดต่อ)[ \t]*[:：][ \t]*)[ก-๙]+(?:[ \t]+[ก-๙]+)?|((?:คุณ|นาย|นางสาว|นาง)[ \t]+)[ก-๙]+/g;

function deidentifyText(text) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }

  return text
    .replace(EMAIL_PATTERN, '[EMAIL]')
    .replace(PHONE_PATTERN, '[PHONE]')
    .replace(LINE_ID_PATTERN, '$1[LINE_ID]')
    .replace(ADDRESS_PATTERN, '$1[ADDRESS]')
    .replace(THAI_NAME_PATTERN, (match, labeledNamePrefix, honorificPrefix) =>
      `${labeledNamePrefix || honorificPrefix}[PERSON]`
    );
}

function collectTextFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing symlink input: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      return collectTextFiles(entryPath);
    }
    return entry.isFile() && path.extname(entry.name).toLowerCase() === '.txt' ? [entryPath] : [];
  });
}

// Containment checks compare fully resolved paths ("." and ".." segments are
// collapsed by path.resolve) and are case-insensitive on Windows, where the
// filesystem treats knowledge\raw and knowledge\RAW as the same directory.
// Matches the helper in scripts/normalize_conversations.js.
function toComparablePath(inputPath) {
  const resolved = path.resolve(inputPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSamePathOrContained(parentPath, childPath) {
  const parent = toComparablePath(parentPath);
  const child = toComparablePath(childPath);
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

function pathsOverlap(firstPath, secondPath) {
  return isSamePathOrContained(firstPath, secondPath) || isSamePathOrContained(secondPath, firstPath);
}

function assertSafeRootDirectory(directory, label) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch {
    return; // Does not exist yet; nothing to follow.
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlink ${label} directory: ${directory}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} path must be a directory: ${directory}`);
  }
}

function processRawDirectory({
  rawDir = DEFAULT_RAW_DIR,
  processedDir = DEFAULT_PROCESSED_DIR,
  dryRun = false
} = {}) {
  const rawRoot = path.resolve(rawDir);
  const processedRoot = path.resolve(processedDir);
  const workspaceRawRoot = path.resolve(DEFAULT_RAW_DIR);

  if (pathsOverlap(rawRoot, processedRoot)) {
    throw new Error('Raw and processed directories must not be the same or nested inside each other.');
  }
  // Output must never overlap the workspace knowledge/raw/, even when a
  // custom raw directory is configured. Checked before anything is created.
  if (pathsOverlap(workspaceRawRoot, processedRoot)) {
    throw new Error(`Refusing to write output inside knowledge/raw/: ${processedRoot}`);
  }
  assertSafeRootDirectory(rawRoot, 'raw');
  assertSafeRootDirectory(processedRoot, 'processed');

  const sourceFiles = collectTextFiles(rawRoot);
  const plannedFiles = [];

  for (const sourceFile of sourceFiles) {
    const relativePath = path.relative(rawRoot, sourceFile);
    const outputFile = path.resolve(processedRoot, relativePath);

    if (!isSamePathOrContained(processedRoot, outputFile) || outputFile === processedRoot) {
      throw new Error(`Refusing to write outside processed directory: ${relativePath}`);
    }

    if (fs.existsSync(outputFile)) {
      throw new Error(`Refusing to overwrite processed file: ${outputFile}`);
    }

    plannedFiles.push({ sourceFile, outputFile, relativePath });
  }

  if (!dryRun) {
    for (const { sourceFile, outputFile } of plannedFiles) {
      const redactedText = deidentifyText(fs.readFileSync(sourceFile, 'utf8'));
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      // Re-check containment against the real (symlink-resolved) parent so a
      // symlinked intermediate directory cannot redirect the write outside
      // the processed tree.
      const realParent = fs.realpathSync(path.dirname(outputFile));
      if (!isSamePathOrContained(fs.realpathSync(processedRoot), realParent)) {
        throw new Error(`Refusing to write outside processed directory: ${outputFile}`);
      }
      // 'wx' fails if the path already exists (including symlinks), so a file
      // created between the plan check and this write can never be overwritten
      // and a symlink at the output path is never followed.
      fs.writeFileSync(outputFile, redactedText, { encoding: 'utf8', flag: 'wx' });
    }
  }

  return {
    processedFiles: dryRun ? 0 : plannedFiles.length,
    plannedFiles: plannedFiles.map(entry => entry.relativePath),
    dryRun
  };
}

function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const unknownFlags = argv.filter(arg => arg !== '--dry-run');
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownFlags.join(', ')}. Supported: --dry-run`);
  }

  const result = processRawDirectory({
    rawDir: process.env.DEIDENTIFY_RAW_DIR || DEFAULT_RAW_DIR,
    processedDir: process.env.DEIDENTIFY_PROCESSED_DIR || DEFAULT_PROCESSED_DIR,
    dryRun
  });
  if (dryRun) {
    console.log(`Dry run: ${result.plannedFiles.length} text file(s) would be processed. No files written.`);
    for (const relativePath of result.plannedFiles) {
      console.log(`  ${relativePath}`);
    }
  } else {
    console.log(`Processed ${result.processedFiles} text file(s) without modifying raw sources.`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`De-identification error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_PROCESSED_DIR,
  DEFAULT_RAW_DIR,
  deidentifyText,
  processRawDirectory
};
