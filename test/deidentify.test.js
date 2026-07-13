const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { deidentifyText, processRawDirectory } = require('../scripts/deidentify');

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'deidentify.js');

function makeTempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deid-test-'));
  const rawDir = path.join(root, 'raw');
  const processedDir = path.join(root, 'processed');
  fs.mkdirSync(rawDir, { recursive: true });
  return { root, rawDir, processedDir };
}

test('replaces common Thai phone number formats', () => {
  const input = 'โทร 081-234-5678 หรือ +66 81 234 5678';

  assert.equal(deidentifyText(input), 'โทร [PHONE] หรือ [PHONE]');
});

test('replaces email addresses', () => {
  const input = 'ส่งแบบไปที่ customer.test@example.com ได้เลย';

  assert.equal(deidentifyText(input), 'ส่งแบบไปที่ [EMAIL] ได้เลย');
});

test('replaces labeled LINE IDs while preserving the label', () => {
  const input = 'LINE ID: stone.shop_01\nไลน์: @oas_stone';

  assert.equal(deidentifyText(input), 'LINE ID: [LINE_ID]\nไลน์: [LINE_ID]');
});

test('replaces Thai names only when a basic label is present', () => {
  const input = 'ชื่อ: สมชาย ใจดี\nคุณ วรรณา โทรมาเรื่องป้าย';

  assert.equal(deidentifyText(input), 'ชื่อ: [PERSON]\nคุณ [PERSON] โทรมาเรื่องป้าย');
});

test('handles mixed Thai and English messages without changing non-PII text', () => {
  const input = 'Hello คุณ สมชาย, please email design@example.com before Friday.';

  assert.equal(
    deidentifyText(input),
    'Hello คุณ [PERSON], please email [EMAIL] before Friday.'
  );
});

test('preserves conversations without PII exactly', () => {
  const input = 'สนใจป้ายหินแกรนิต ขนาด 30 x 20 ซม.\nPlease send a material sample.';

  assert.equal(deidentifyText(input), input);
});

test('replaces a labeled address without changing surrounding conversation', () => {
  const input = 'ส่งที่: 12 ถนนสุขุมวิท กรุงเทพฯ\nงานพร้อมตรวจแบบแล้ว';

  assert.equal(deidentifyText(input), 'ส่งที่: [ADDRESS]\nงานพร้อมตรวจแบบแล้ว');
});

// --- Non-PII preservation ---

test('does not redact Thai words that merely start with an honorific prefix', () => {
  const inputs = ['คุณภาพดี', 'นายช่างจะโทรมา', 'ชื่อสินค้า: หินอ่อน'];

  for (const input of inputs) {
    assert.equal(deidentifyText(input), input);
  }
});

test('preserves Thai description text immediately following a detected honorific name', () => {
  const input = 'คุณ สมชาย ต้องการป้ายหินแกรนิตสีดำ';

  assert.equal(deidentifyText(input), 'คุณ [PERSON] ต้องการป้ายหินแกรนิตสีดำ');
});

// --- Idempotence ---

test('is idempotent: placeholders survive a second pass unchanged', () => {
  const original = [
    'ชื่อ: สมชาย ใจดี',
    'โทร 081-234-5678 หรือ +66812345678',
    'อีเมล Customer.Test@Example.COM',
    'LINE ID: stone.shop_01-a',
    'ที่อยู่: 12 ถนนสุขุมวิท กรุงเทพฯ'
  ].join('\n');

  const oncePass = deidentifyText(original);
  const twicePass = deidentifyText(oncePass);

  assert.equal(twicePass, oncePass);
  for (const placeholder of ['[PERSON]', '[PHONE]', '[EMAIL]', '[LINE_ID]', '[ADDRESS]']) {
    assert.ok(oncePass.includes(placeholder), `expected ${placeholder} in first pass output`);
  }
});

test('leaves standalone placeholders untouched', () => {
  const input = 'คุยกับ [PERSON] เบอร์ [PHONE] เมล [EMAIL] ไลน์ [LINE_ID] ส่ง [ADDRESS]';

  assert.equal(deidentifyText(input), input);
});

// --- PII edge cases ---

test('replaces Thai phone numbers with and without separators', () => {
  const cases = [
    ['0812345678', '[PHONE]'],
    ['081-234-5678', '[PHONE]'],
    ['081 234 5678', '[PHONE]'],
    ['02-123-4567', '[PHONE]']
  ];

  for (const [input, expected] of cases) {
    assert.equal(deidentifyText(input), expected);
  }
});

test('replaces international +66 phone numbers', () => {
  assert.equal(deidentifyText('ติดต่อ +66812345678'), 'ติดต่อ [PHONE]');
  assert.equal(deidentifyText('ติดต่อ +66 81 234 5678'), 'ติดต่อ [PHONE]');
});

test('replaces emails regardless of letter case', () => {
  assert.equal(deidentifyText('ส่งไป Customer.Test@EXAMPLE.COM'), 'ส่งไป [EMAIL]');
  assert.equal(deidentifyText('ส่งไป customer@example.com'), 'ส่งไป [EMAIL]');
});

test('replaces LINE IDs containing dots, underscores, and hyphens', () => {
  const input = 'LINE ID: shop.name_x-1';

  assert.equal(deidentifyText(input), 'LINE ID: [LINE_ID]');
});

test('replaces multiple PII values on a single line', () => {
  const input = 'คุณ สมชาย โทร 0812345678 เมล a.b@example.com LINE: my_line.id-1';

  assert.equal(
    deidentifyText(input),
    'คุณ [PERSON] โทร [PHONE] เมล [EMAIL] LINE: [LINE_ID]'
  );
});

// --- Encoding and formatting ---

test('preserves UTF-8 Thai text, blank lines, and line ordering', () => {
  const input = 'บรรทัดแรก ป้ายหินอ่อน\n\nบรรทัดสาม ราคา 5,000 บาท\n';

  assert.equal(deidentifyText(input), input);
});

test('preserves CRLF line endings around redacted spans', () => {
  const input = 'โทร 081-234-5678\r\n\r\nขอบคุณ\r\n';

  assert.equal(deidentifyText(input), 'โทร [PHONE]\r\n\r\nขอบคุณ\r\n');
});

// --- File safety (synthetic temp workspaces only) ---

function writeRawFile(rawDir, relativePath, content) {
  const filePath = path.join(rawDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

test('processes .txt files into matching nested relative paths', () => {
  const { rawDir, processedDir } = makeTempWorkspace();
  writeRawFile(rawDir, path.join('2026', '07', 'chat.txt'), 'โทร 0812345678\n');

  const result = processRawDirectory({ rawDir, processedDir });

  assert.equal(result.processedFiles, 1);
  const output = fs.readFileSync(path.join(processedDir, '2026', '07', 'chat.txt'), 'utf8');
  assert.equal(output, 'โทร [PHONE]\n');
});

test('never modifies raw source files', () => {
  const { rawDir, processedDir } = makeTempWorkspace();
  const content = 'คุณ สมชาย โทร 0812345678\n';
  const rawFile = writeRawFile(rawDir, 'chat.txt', content);

  processRawDirectory({ rawDir, processedDir });

  assert.equal(fs.readFileSync(rawFile, 'utf8'), content);
});

test('ignores non-.txt files', () => {
  const { rawDir, processedDir } = makeTempWorkspace();
  writeRawFile(rawDir, 'export.csv', 'โทร 0812345678\n');
  writeRawFile(rawDir, 'notes.md', 'โทร 0812345678\n');

  const result = processRawDirectory({ rawDir, processedDir });

  assert.equal(result.processedFiles, 0);
  assert.equal(fs.existsSync(path.join(processedDir, 'export.csv')), false);
  assert.equal(fs.existsSync(path.join(processedDir, 'notes.md')), false);
});

test('refuses to overwrite an existing processed file', () => {
  const { rawDir, processedDir } = makeTempWorkspace();
  writeRawFile(rawDir, 'chat.txt', 'โทร 0812345678\n');
  fs.mkdirSync(processedDir, { recursive: true });
  fs.writeFileSync(path.join(processedDir, 'chat.txt'), 'reviewed output\n', 'utf8');

  assert.throws(
    () => processRawDirectory({ rawDir, processedDir }),
    /Refusing to overwrite/
  );
  assert.equal(fs.readFileSync(path.join(processedDir, 'chat.txt'), 'utf8'), 'reviewed output\n');
});

test('rejects raw and processed directories resolving to the same path', () => {
  const { rawDir } = makeTempWorkspace();

  assert.throws(
    () => processRawDirectory({ rawDir, processedDir: rawDir }),
    /must not be the same or nested/
  );
});

test('rejects a processed directory nested inside the raw directory and vice versa', () => {
  const { rawDir, processedDir } = makeTempWorkspace();

  assert.throws(
    () => processRawDirectory({ rawDir, processedDir: path.join(rawDir, 'out') }),
    /must not be the same or nested/
  );
  assert.throws(
    () => processRawDirectory({ rawDir: path.join(processedDir, 'in'), processedDir }),
    /must not be the same or nested/
  );
});

test('does not follow symbolic links inside the raw directory', t => {
  const { root, rawDir, processedDir } = makeTempWorkspace();
  const outsideFile = path.join(root, 'outside.txt');
  fs.writeFileSync(outsideFile, 'โทร 0812345678\n', 'utf8');

  try {
    fs.symlinkSync(outsideFile, path.join(rawDir, 'link.txt'), 'file');
  } catch (error) {
    t.skip(`symlink creation not permitted on this system: ${error.code}`);
    return;
  }

  const result = processRawDirectory({ rawDir, processedDir });

  assert.equal(result.processedFiles, 0);
  assert.equal(fs.existsSync(path.join(processedDir, 'link.txt')), false);
});

test('dry run reports planned files without writing anything', () => {
  const { rawDir, processedDir } = makeTempWorkspace();
  writeRawFile(rawDir, 'chat.txt', 'โทร 0812345678\n');

  const result = processRawDirectory({ rawDir, processedDir, dryRun: true });

  assert.equal(result.dryRun, true);
  assert.equal(result.processedFiles, 0);
  assert.deepEqual(result.plannedFiles, ['chat.txt']);
  assert.equal(fs.existsSync(processedDir), false);
});

// --- CLI behavior ---

// Every CLI invocation points DEIDENTIFY_RAW_DIR / DEIDENTIFY_PROCESSED_DIR at a
// synthetic temp workspace so tests never touch the real knowledge/raw/ tree.
function runCli(args, { rawDir, processedDir }) {
  const env = {
    ...process.env,
    DEIDENTIFY_RAW_DIR: rawDir,
    DEIDENTIFY_PROCESSED_DIR: processedDir
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

test('CLI exits non-zero on unknown arguments', () => {
  const workspace = makeTempWorkspace();
  const { status, stderr } = runCli(['--bogus-flag'], workspace);

  assert.notEqual(status, 0);
  assert.match(stderr, /Unknown argument/);
});

test('CLI supports --dry-run: exits zero and writes nothing', () => {
  const workspace = makeTempWorkspace();
  writeRawFile(workspace.rawDir, 'chat.txt', 'โทร 0812345678\n');

  const { status, stdout } = runCli(['--dry-run'], workspace);

  assert.equal(status, 0);
  assert.match(stdout, /Dry run/);
  assert.equal(fs.existsSync(workspace.processedDir), false);
});

test('CLI exits non-zero on overwrite conflicts and never prints original PII', () => {
  const workspace = makeTempWorkspace();
  const secretPhone = '0899998888';
  writeRawFile(workspace.rawDir, 'chat.txt', `โทร ${secretPhone}\n`);
  fs.mkdirSync(workspace.processedDir, { recursive: true });
  fs.writeFileSync(path.join(workspace.processedDir, 'chat.txt'), 'existing\n', 'utf8');

  const { status, stdout, stderr } = runCli([], workspace);

  assert.notEqual(status, 0);
  assert.match(stderr, /Refusing to overwrite/);
  assert.equal(stdout.includes(secretPhone), false);
  assert.equal(stderr.includes(secretPhone), false);
});

test('error paths never log original file contents', () => {
  const { rawDir, processedDir } = makeTempWorkspace();
  const secretPhone = '0899998888';
  writeRawFile(rawDir, 'chat.txt', `โทร ${secretPhone}\n`);
  fs.mkdirSync(processedDir, { recursive: true });
  fs.writeFileSync(path.join(processedDir, 'chat.txt'), 'existing\n', 'utf8');

  try {
    processRawDirectory({ rawDir, processedDir });
    assert.fail('expected an overwrite error');
  } catch (error) {
    assert.equal(error.message.includes(secretPhone), false);
  }
});
