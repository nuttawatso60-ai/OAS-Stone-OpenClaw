#!/usr/bin/env node

// Knowledge Pipeline v2 processed conversation normalization stage.
//
// Safety guarantees:
// - Reads only .txt files from the configured processed directory.
// - Refuses any input path inside knowledge/raw/.
// - Rejects symbolic links instead of following them.
// - Refuses to write output inside knowledge/processed/.
// - Refuses to write output inside knowledge/raw/.
// - Never overwrites output unless --force is supplied.
// - Writes through a temporary file in the destination directory.
// - Logs only counts, paths, and validation status; never conversation text.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');

const WORKSPACE_DIR = path.resolve(__dirname, '..');
const DEFAULT_PROCESSED_DIR = path.join(WORKSPACE_DIR, 'knowledge', 'processed');
const DEFAULT_RAW_DIR = path.join(WORKSPACE_DIR, 'knowledge', 'raw');
const DEFAULT_OUTPUT_PATH = path.join(
  WORKSPACE_DIR,
  'knowledge',
  'datasets',
  'drafts',
  'processed_conversations.json'
);
const SCHEMA_PATH = path.join(
  WORKSPACE_DIR,
  'knowledge',
  'datasets',
  'schemas',
  'processed_conversations.schema.json'
);

const DEFAULT_PREFIXES = Object.freeze([
  { prefix: 'Customer:', speaker: 'customer' },
  { prefix: 'Agent:', speaker: 'agent' },
  { prefix: 'ลูกค้า:', speaker: 'customer' },
  { prefix: 'แอดมิน:', speaker: 'agent' }
]);

// Containment checks compare fully resolved paths ("." and ".." segments are
// collapsed by path.resolve) and are case-insensitive on Windows, where the
// filesystem treats knowledge\raw and knowledge\RAW as the same directory.
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

function normalizePathForRecord(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function recordIdFromRelativePath(relativePath) {
  return `processed_conversation_${sha256Hex(normalizePathForRecord(relativePath)).slice(0, 24)}`;
}

function parsePrefixSpec(spec) {
  const separatorIndex = spec.lastIndexOf('=');
  if (separatorIndex <= 0 || separatorIndex === spec.length - 1) {
    throw new Error('Prefix specs must use <prefix>=<speaker>, for example Customer:=customer');
  }

  const prefix = spec.slice(0, separatorIndex);
  const speaker = spec.slice(separatorIndex + 1);

  if (!prefix || !speaker || /\s/.test(speaker)) {
    throw new Error('Prefix specs require a non-empty prefix and single-token speaker.');
  }

  return { prefix, speaker };
}

function compilePrefixMatchers(prefixes = DEFAULT_PREFIXES) {
  return [...prefixes]
    .map(entry => {
      if (!entry || typeof entry.prefix !== 'string' || typeof entry.speaker !== 'string') {
        throw new Error('Speaker prefixes must be objects with prefix and speaker strings.');
      }
      if (entry.prefix.length === 0 || entry.speaker.length === 0) {
        throw new Error('Speaker prefixes must not be empty.');
      }
      return { prefix: entry.prefix, speaker: entry.speaker };
    })
    .sort((a, b) => b.prefix.length - a.prefix.length);
}

function appendLine(message, line) {
  message.text = message.text.length === 0 ? line : `${message.text}\n${line}`;
}

// Canonical format: a single terminal line terminator (LF, CRLF, or CR) is
// end-of-file formatting, not conversation content, and is stripped before
// parsing. Any blank lines beyond that single terminator are real content and
// are preserved, as are all blank lines inside the conversation. Note that
// content_sha256 is always computed over the original file content including
// any terminal newline; only parsed message text excludes it.
function stripTerminalNewline(text) {
  return text.replace(/\r\n$|\n$|\r$/, '');
}

function parseMessages(text, prefixes = DEFAULT_PREFIXES) {
  const matchers = compilePrefixMatchers(prefixes);
  const body = stripTerminalNewline(text);
  const lines = body.length === 0 ? [] : body.split(/\r\n|\n|\r/);
  const messages = [];
  let current = null;

  for (const line of lines) {
    const matchedPrefix = matchers.find(entry => line.startsWith(entry.prefix));

    if (matchedPrefix) {
      const rawText = line.slice(matchedPrefix.prefix.length).replace(/^[ \t]/, '');
      current = {
        index: messages.length,
        speaker: matchedPrefix.speaker,
        text: rawText
      };
      messages.push(current);
      continue;
    }

    if (current && (line === '' || /^[ \t]/.test(line))) {
      appendLine(current, line);
      continue;
    }

    if (current && current.speaker === 'unknown') {
      appendLine(current, line);
      continue;
    }

    current = {
      index: messages.length,
      speaker: 'unknown',
      text: line
    };
    messages.push(current);
  }

  return messages;
}

function collectTextFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlink input: ${directory}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Input path must be a directory: ${directory}`);
  }

  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing symlink input: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      output.push(...collectTextFiles(entryPath));
      continue;
    }
    if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.txt') {
      output.push(entryPath);
    }
  }
  return output.sort((a, b) => a.localeCompare(b));
}

function resolveOutputPath(outputArg = DEFAULT_OUTPUT_PATH) {
  const resolved = path.resolve(outputArg);
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isDirectory()) {
    return path.join(resolved, 'processed_conversations.json');
  }
  if (path.extname(resolved).toLowerCase() === '.json') {
    return resolved;
  }
  return path.join(resolved, 'processed_conversations.json');
}

function validateOutput(document, schemaPath = SCHEMA_PATH) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  if (!validate(document)) {
    const details = validate.errors
      .map(error => `${error.instancePath || '/'} ${error.message}`)
      .join('; ');
    throw new Error(`Generated processed conversations failed schema validation: ${details}`);
  }

  return true;
}

function writeJsonAtomic(outputPath, document, { force = false } = {}) {
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  if (fs.existsSync(outputPath) && !force) {
    throw new Error(`Refusing to overwrite output file without --force: ${outputPath}`);
  }

  const tempPath = path.join(
    outputDir,
    `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`
  );

  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    });
    fs.renameSync(tempPath, outputPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function normalizeProcessedConversations({
  inputDir = DEFAULT_PROCESSED_DIR,
  rawDir = DEFAULT_RAW_DIR,
  outputPath = DEFAULT_OUTPUT_PATH,
  prefixes = DEFAULT_PREFIXES,
  dryRun = false,
  force = false,
  normalizedAt = new Date().toISOString()
} = {}) {
  const inputRoot = path.resolve(inputDir);
  const rawRoot = path.resolve(rawDir);
  const processedRoot = path.resolve(DEFAULT_PROCESSED_DIR);
  const finalOutputPath = resolveOutputPath(outputPath);

  // Reject input touching either the configured raw directory or the real
  // workspace knowledge/raw/, regardless of what rawDir the caller passed.
  const workspaceRawRoot = path.resolve(DEFAULT_RAW_DIR);
  if (
    isSamePathOrContained(rawRoot, inputRoot) ||
    isSamePathOrContained(inputRoot, rawRoot) ||
    isSamePathOrContained(workspaceRawRoot, inputRoot) ||
    isSamePathOrContained(inputRoot, workspaceRawRoot)
  ) {
    throw new Error(`Refusing to read input path inside knowledge/raw/: ${inputRoot}`);
  }
  if (isSamePathOrContained(processedRoot, finalOutputPath) || isSamePathOrContained(inputRoot, finalOutputPath)) {
    throw new Error(`Output path must be outside knowledge/processed/: ${finalOutputPath}`);
  }
  if (
    isSamePathOrContained(rawRoot, finalOutputPath) ||
    isSamePathOrContained(workspaceRawRoot, finalOutputPath)
  ) {
    throw new Error(`Output path must be outside knowledge/raw/: ${finalOutputPath}`);
  }
  if (fs.existsSync(finalOutputPath) && fs.lstatSync(finalOutputPath).isSymbolicLink()) {
    throw new Error(`Refusing symlink output path: ${finalOutputPath}`);
  }

  const records = collectTextFiles(inputRoot).map(sourceFile => {
    const relativePath = path.relative(inputRoot, sourceFile);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error(`Refusing path traversal input: ${sourceFile}`);
    }

    const normalizedRelativePath = normalizePathForRecord(relativePath);
    const content = fs.readFileSync(sourceFile, 'utf8');
    const messages = parseMessages(content, prefixes);

    return {
      id: recordIdFromRelativePath(normalizedRelativePath),
      schema_version: '1.0',
      source_ref: normalizedRelativePath,
      source_path: normalizedRelativePath,
      content_sha256: sha256Hex(content),
      normalized_at: normalizedAt,
      status: content.length === 0 ? 'empty' : 'normalized',
      messages
    };
  });

  const document = {
    schema_version: '1.0',
    items: records
  };

  validateOutput(document);

  if (!dryRun) {
    writeJsonAtomic(finalOutputPath, document, { force });
  }

  return {
    dryRun,
    outputPath: finalOutputPath,
    recordCount: records.length,
    sourceRefs: records.map(record => record.source_ref),
    document
  };
}

function parseArgs(argv) {
  const options = {
    inputDir: process.env.NORMALIZE_PROCESSED_DIR || DEFAULT_PROCESSED_DIR,
    rawDir: process.env.NORMALIZE_RAW_DIR || DEFAULT_RAW_DIR,
    outputPath: process.env.NORMALIZE_OUTPUT_PATH || DEFAULT_OUTPUT_PATH,
    prefixes: [...DEFAULT_PREFIXES],
    dryRun: false,
    force: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--input-dir') {
      options.inputDir = argv[++index];
    } else if (arg === '--output') {
      options.outputPath = argv[++index];
    } else if (arg === '--prefix') {
      options.prefixes.push(parsePrefixSpec(argv[++index]));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }

    if (options.inputDir === undefined || options.outputPath === undefined) {
      throw new Error(`Missing value after ${arg}`);
    }
  }

  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = normalizeProcessedConversations(options);

  if (result.dryRun) {
    console.log(`Dry run: ${result.recordCount} processed conversation record(s) would be written. No files written.`);
  } else {
    console.log(`Normalized ${result.recordCount} processed conversation record(s).`);
    console.log(`Output: ${result.outputPath}`);
  }
  for (const sourceRef of result.sourceRefs) {
    console.log(`  ${sourceRef}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Conversation normalization error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  DEFAULT_PREFIXES,
  DEFAULT_PROCESSED_DIR,
  DEFAULT_RAW_DIR,
  parseMessages,
  normalizeProcessedConversations,
  recordIdFromRelativePath,
  validateOutput
};
