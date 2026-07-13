const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  normalizeProcessedConversations,
  parseMessages,
  recordIdFromRelativePath,
  validateOutput
} = require('../scripts/normalize_conversations');

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'normalize_conversations.js');
const FIXED_TIME = '2026-07-13T00:00:00.000Z';

function makeTempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'normalize-test-'));
  const processedDir = path.join(root, 'knowledge', 'processed');
  const rawDir = path.join(root, 'knowledge', 'raw');
  const outputDir = path.join(root, 'knowledge', 'datasets', 'drafts');
  fs.mkdirSync(processedDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });
  return { root, processedDir, rawDir, outputDir };
}

function writeProcessedFile(processedDir, relativePath, content) {
  const filePath = path.join(processedDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function normalize(workspace, options = {}) {
  return normalizeProcessedConversations({
    inputDir: workspace.processedDir,
    rawDir: workspace.rawDir,
    outputPath: options.outputPath || workspace.outputDir,
    normalizedAt: FIXED_TIME,
    ...options
  });
}

test('parses Thai and English speaker prefixes only when explicit', () => {
  const messages = parseMessages('Customer: hello\nAgent: hi\nลูกค้า: สวัสดี\nแอดมิน: รับทราบ');

  assert.deepEqual(messages, [
    { index: 0, speaker: 'customer', text: 'hello' },
    { index: 1, speaker: 'agent', text: 'hi' },
    { index: 2, speaker: 'customer', text: 'สวัสดี' },
    { index: 3, speaker: 'agent', text: 'รับทราบ' }
  ]);
});

test('preserves unknown speaker lines without inferring attribution', () => {
  const messages = parseMessages('Customer: สวัสดี\nไม่มี prefix\nอีกบรรทัด');

  assert.deepEqual(messages, [
    { index: 0, speaker: 'customer', text: 'สวัสดี' },
    { index: 1, speaker: 'unknown', text: 'ไม่มี prefix\nอีกบรรทัด' }
  ]);
});

test('keeps indented multiline message text and blank-line meaning', () => {
  const messages = parseMessages('Customer: line one\n  line two\n\nAgent: ok');

  assert.deepEqual(messages, [
    { index: 0, speaker: 'customer', text: 'line one\n  line two\n' },
    { index: 1, speaker: 'agent', text: 'ok' }
  ]);
});

test('does not append a phantom trailing newline caused only by end-of-file formatting', () => {
  const withEofNewline = parseMessages('Customer: Sawasdee\n');
  const withoutEofNewline = parseMessages('Customer: Sawasdee');

  assert.deepEqual(
    withEofNewline,
    [{ index: 0, speaker: 'customer', text: 'Sawasdee' }],
    'a single terminal newline is end-of-file formatting, not conversation content, and must not be captured in message text'
  );
  assert.deepEqual(withEofNewline, withoutEofNewline);
});

test('normalizes empty files as empty records', () => {
  const workspace = makeTempWorkspace();
  writeProcessedFile(workspace.processedDir, 'empty.txt', '');

  const result = normalize(workspace);

  assert.equal(result.document.items.length, 1);
  assert.equal(result.document.items[0].status, 'empty');
  assert.deepEqual(result.document.items[0].messages, []);
});

test('preserves nested input paths as normalized source refs', () => {
  const workspace = makeTempWorkspace();
  writeProcessedFile(workspace.processedDir, path.join('2026', '07', 'chat.txt'), 'Customer: hi');

  const result = normalize(workspace);

  assert.equal(result.document.items[0].source_ref, '2026/07/chat.txt');
  assert.equal(result.document.items[0].source_path, '2026/07/chat.txt');
});

test('uses stable IDs and content hashes for unchanged input', () => {
  const workspace = makeTempWorkspace();
  writeProcessedFile(workspace.processedDir, 'chat.txt', 'Customer: [PHONE]\n');

  const first = normalize(workspace, { dryRun: true });
  const second = normalize(workspace, { dryRun: true });

  assert.equal(first.document.items[0].id, second.document.items[0].id);
  assert.equal(first.document.items[0].id, recordIdFromRelativePath('chat.txt'));
  assert.equal(first.document.items[0].content_sha256, second.document.items[0].content_sha256);
});

test('preserves redaction placeholders exactly', () => {
  const workspace = makeTempWorkspace();
  writeProcessedFile(workspace.processedDir, 'chat.txt', 'Customer: ติดต่อ [PHONE] หรือ [EMAIL]\n');

  const result = normalize(workspace);

  assert.equal(result.document.items[0].messages[0].text, 'ติดต่อ [PHONE] หรือ [EMAIL]');
});

test('preserves terminal blank lines beyond the single EOF newline as content', () => {
  const messages = parseMessages('Customer: hi\n\n\n');

  assert.deepEqual(messages, [{ index: 0, speaker: 'customer', text: 'hi\n\n' }]);
});

test('strips a single terminal CRLF the same as LF', () => {
  assert.deepEqual(parseMessages('Customer: hi\r\n'), [
    { index: 0, speaker: 'customer', text: 'hi' }
  ]);
});

test('content hash covers the original file content including the terminal newline', () => {
  const crypto = require('node:crypto');
  const workspace = makeTempWorkspace();
  const contentWithNewline = 'Customer: hi\n';
  writeProcessedFile(workspace.processedDir, 'with_newline.txt', contentWithNewline);
  writeProcessedFile(workspace.processedDir, 'without_newline.txt', 'Customer: hi');

  const result = normalize(workspace, { dryRun: true });
  const byRef = Object.fromEntries(result.document.items.map(item => [item.source_ref, item]));

  assert.deepEqual(byRef['with_newline.txt'].messages, byRef['without_newline.txt'].messages);
  assert.notEqual(byRef['with_newline.txt'].content_sha256, byRef['without_newline.txt'].content_sha256);
  assert.equal(
    byRef['with_newline.txt'].content_sha256,
    crypto.createHash('sha256').update(contentWithNewline).digest('hex')
  );
});

test('rejects invalid generated output through schema validation', () => {
  assert.throws(
    () => validateOutput({ schema_version: '1.0', items: [{ id: 'bad' }] }),
    /failed schema validation/
  );
});

test('protects existing output from overwrite', () => {
  const workspace = makeTempWorkspace();
  const outputPath = path.join(workspace.outputDir, 'processed_conversations.json');
  writeProcessedFile(workspace.processedDir, 'chat.txt', 'Customer: hi');
  fs.mkdirSync(workspace.outputDir, { recursive: true });
  fs.writeFileSync(outputPath, '{"existing":true}\n', 'utf8');

  assert.throws(
    () => normalize(workspace, { outputPath }),
    /Refusing to overwrite output file without --force/
  );
  assert.equal(fs.readFileSync(outputPath, 'utf8'), '{"existing":true}\n');
});

test('supports --force overwrite through function options', () => {
  const workspace = makeTempWorkspace();
  const outputPath = path.join(workspace.outputDir, 'processed_conversations.json');
  writeProcessedFile(workspace.processedDir, 'chat.txt', 'Customer: hi');
  fs.mkdirSync(workspace.outputDir, { recursive: true });
  fs.writeFileSync(outputPath, '{"existing":true}\n', 'utf8');

  const result = normalize(workspace, { outputPath, force: true });

  assert.equal(result.recordCount, 1);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /processed_conversation_/);
});

test('supports --dry-run without writing output', () => {
  const workspace = makeTempWorkspace();
  writeProcessedFile(workspace.processedDir, 'chat.txt', 'Customer: hi');

  const result = normalize(workspace, { dryRun: true });

  assert.equal(result.dryRun, true);
  assert.equal(fs.existsSync(path.join(workspace.outputDir, 'processed_conversations.json')), false);
});

test('rejects input paths inside raw directory', () => {
  const workspace = makeTempWorkspace();
  writeProcessedFile(workspace.rawDir, 'chat.txt', 'Customer: hi');

  assert.throws(
    () => normalizeProcessedConversations({
      inputDir: workspace.rawDir,
      rawDir: workspace.rawDir,
      outputPath: workspace.outputDir,
      normalizedAt: FIXED_TIME
    }),
    /Refusing to read input path inside knowledge\/raw\//
  );
});

test('rejects output directly inside raw directory before writing anything', () => {
  const workspace = makeTempWorkspace();
  writeProcessedFile(workspace.processedDir, 'chat.txt', 'Customer: SECRET_SYNTHETIC_CONTENT');
  const outputPath = path.join(workspace.rawDir, 'processed_conversations.json');

  assert.throws(
    () => normalize(workspace, { outputPath }),
    /Output path must be outside knowledge\/raw\//
  );
  assert.equal(fs.existsSync(outputPath), false);
  assert.deepEqual(
    fs.readdirSync(workspace.rawDir).filter(name => name.includes('processed_conversations')),
    []
  );
});

test('rejects output inside raw directory through ".." traversal before creating directories', () => {
  const workspace = makeTempWorkspace();
  writeProcessedFile(workspace.processedDir, 'chat.txt', 'Customer: hi');
  const outputDir = path.join(workspace.outputDir, '..', '..', 'raw', 'nested');
  const outputPath = path.join(outputDir, 'processed_conversations.json');

  assert.throws(
    () => normalize(workspace, { outputPath }),
    /Output path must be outside knowledge\/raw\//
  );
  assert.equal(fs.existsSync(outputDir), false);
});

test('rejects differently-cased raw output paths on Windows', t => {
  if (process.platform !== 'win32') {
    t.skip('case-insensitive path comparison applies to Windows only');
    return;
  }

  const workspace = makeTempWorkspace();
  writeProcessedFile(workspace.processedDir, 'chat.txt', 'Customer: hi');
  const upperCaseRawPath = path.join(path.dirname(workspace.rawDir), 'RAW', 'processed_conversations.json');

  assert.throws(
    () => normalize(workspace, { outputPath: upperCaseRawPath }),
    /Output path must be outside knowledge\/raw\//
  );
  assert.equal(fs.existsSync(upperCaseRawPath), false);
});

test('--force does not bypass raw output rejection', () => {
  const workspace = makeTempWorkspace();
  writeProcessedFile(workspace.processedDir, 'chat.txt', 'Customer: SECRET_SYNTHETIC_CONTENT');
  const outputPath = path.join(workspace.rawDir, 'processed_conversations.json');

  assert.throws(
    () => normalize(workspace, { outputPath, force: true }),
    /Output path must be outside knowledge\/raw\//
  );
  assert.equal(fs.existsSync(outputPath), false);
});

test('raw output rejection does not create parent or temp files', () => {
  const workspace = makeTempWorkspace();
  writeProcessedFile(workspace.processedDir, 'chat.txt', 'Customer: hi');
  const outputDir = path.join(workspace.rawDir, 'new-output-dir');
  const outputPath = path.join(outputDir, 'processed_conversations.json');

  assert.throws(
    () => normalize(workspace, { outputPath }),
    /Output path must be outside knowledge\/raw\//
  );
  assert.equal(fs.existsSync(outputDir), false);
  assert.deepEqual(
    fs.readdirSync(workspace.rawDir).filter(name => name.endsWith('.tmp')),
    []
  );
});

test('rejects input paths reaching raw through "." and ".." segments', () => {
  const workspace = makeTempWorkspace();
  const dottedRawPath = path.join(workspace.processedDir, '..', 'raw', '.');

  assert.throws(
    () => normalizeProcessedConversations({
      inputDir: dottedRawPath,
      rawDir: workspace.rawDir,
      outputPath: workspace.outputDir,
      normalizedAt: FIXED_TIME
    }),
    /Refusing to read input path inside knowledge\/raw\//
  );
});

test('rejects raw input paths that differ only by case on Windows', t => {
  if (process.platform !== 'win32') {
    t.skip('case-insensitive path comparison applies to Windows only');
    return;
  }

  const workspace = makeTempWorkspace();
  const upperCaseRawPath = path.join(path.dirname(workspace.rawDir), 'RAW');

  assert.throws(
    () => normalizeProcessedConversations({
      inputDir: upperCaseRawPath,
      rawDir: workspace.rawDir,
      outputPath: workspace.outputDir,
      normalizedAt: FIXED_TIME
    }),
    /Refusing to read input path inside knowledge\/raw\//
  );
});

test('rejects the real workspace knowledge/raw/ even with a different rawDir configured', () => {
  const workspace = makeTempWorkspace();
  const { DEFAULT_RAW_DIR } = require('../scripts/normalize_conversations');

  assert.throws(
    () => normalizeProcessedConversations({
      inputDir: DEFAULT_RAW_DIR,
      rawDir: workspace.rawDir,
      outputPath: workspace.outputDir,
      normalizedAt: FIXED_TIME
    }),
    /Refusing to read input path inside knowledge\/raw\//
  );
});

test('rejects symlink inputs where supported', t => {
  const workspace = makeTempWorkspace();
  const target = path.join(workspace.root, 'outside.txt');
  fs.writeFileSync(target, 'Customer: hi', 'utf8');

  try {
    fs.symlinkSync(target, path.join(workspace.processedDir, 'link.txt'), 'file');
  } catch (error) {
    t.skip(`symlink creation not permitted on this system: ${error.code}`);
    return;
  }

  assert.throws(
    () => normalize(workspace),
    /Refusing symlink input/
  );
});

function runCli(args, workspace) {
  const env = {
    ...process.env,
    NORMALIZE_PROCESSED_DIR: workspace.processedDir,
    NORMALIZE_RAW_DIR: workspace.rawDir,
    NORMALIZE_OUTPUT_PATH: path.join(workspace.outputDir, 'processed_conversations.json')
  };

  try {
    const stdout = execFileSync(process.execPath, [SCRIPT_PATH, ...args], {
      encoding: 'utf8',
      env
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      status: error.status,
      stdout: error.stdout || '',
      stderr: error.stderr || ''
    };
  }
}

test('CLI dry-run does not print source conversation content', () => {
  const workspace = makeTempWorkspace();
  const secret = 'SECRET_SYNTHETIC_CONTENT';
  writeProcessedFile(workspace.processedDir, 'chat.txt', `Customer: ${secret}`);

  const { status, stdout, stderr } = runCli(['--dry-run'], workspace);

  assert.equal(status, 0);
  assert.equal(stdout.includes(secret), false);
  assert.equal(stderr.includes(secret), false);
  assert.match(stdout, /chat\.txt/);
});

test('CLI overwrite error does not print source conversation content', () => {
  const workspace = makeTempWorkspace();
  const secret = 'SECRET_SYNTHETIC_CONTENT';
  writeProcessedFile(workspace.processedDir, 'chat.txt', `Customer: ${secret}`);
  fs.mkdirSync(workspace.outputDir, { recursive: true });
  fs.writeFileSync(path.join(workspace.outputDir, 'processed_conversations.json'), '{}\n', 'utf8');

  const { status, stdout, stderr } = runCli([], workspace);

  assert.notEqual(status, 0);
  assert.equal(stdout.includes(secret), false);
  assert.equal(stderr.includes(secret), false);
  assert.match(stderr, /Refusing to overwrite output file without --force/);
});
