const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { canonicalize } = require('../scripts/lib/extraction/canonical_json');
const { sha256Hex, hashCanonical, hashId } = require('../scripts/lib/extraction/hashing');
const {
  normalizeForComparison,
  isSamePathOrContained,
  resolveInside,
  assertOutside,
  assertNoSymlink
} = require('../scripts/lib/extraction/path_safety');

function makeTempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'extraction-core-')));
}

// Creates a directory link for symlink tests. Windows refuses plain symlinks
// without elevated rights (EPERM), but junctions are allowed and Node reports
// them as symbolic links, so they exercise the same lstat-based checks.
function makeDirLink(targetDir, linkPath) {
  try {
    fs.symlinkSync(targetDir, linkPath, 'dir');
    return true;
  } catch (error) {
    if (error.code !== 'EPERM') {
      throw error;
    }
  }
  try {
    fs.symlinkSync(targetDir, linkPath, 'junction');
    return true;
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EINVAL') {
      return false;
    }
    throw error;
  }
}

test('canonicalize sorts object keys by UTF-16 code-unit order', () => {
  assert.equal(canonicalize({ b: 2, a: 1, A: 0 }), '{"A":0,"a":1,"b":2}');
});

test('canonicalize sorts nested object keys while preserving array order', () => {
  const value = { z: [{ b: 2, a: 1 }, 3], a: true };

  assert.equal(canonicalize(value), '{"a":true,"z":[{"a":1,"b":2},3]}');
});

test('canonicalize normalizes strings to Unicode NFC', () => {
  const composed = canonicalize({ text: '\u00e9' });
  const decomposed = canonicalize({ text: 'e\u0301' });

  assert.equal(composed, '{"text":"é"}');
  assert.equal(decomposed, composed);
});

test('canonicalize preserves Thai and English strings', () => {
  assert.equal(
    canonicalize({ th: 'สวัสดี', en: 'hello' }),
    '{"en":"hello","th":"สวัสดี"}'
  );
});

test('canonicalize escapes JSON strings correctly', () => {
  const output = canonicalize({
    text: 'quote " slash \\ tab\t cr\r lf\n nul\0 unit\u001f'
  });

  assert.equal(
    output,
    '{"text":"quote \\" slash \\\\ tab\\t cr\\r lf\\n nul\\u0000 unit\\u001f"}'
  );
});

test('canonicalize supports integers including zero and negative integers', () => {
  assert.equal(canonicalize({ n: -42, z: 0 }), '{"n":-42,"z":0}');
});

test('canonicalize rejects floats, NaN, and Infinity', () => {
  for (const value of [1.2, NaN, Infinity, -Infinity]) {
    assert.throws(() => canonicalize(value), /Canonical JSON error/);
  }
});

test('canonicalize rejects unsupported values', () => {
  class Example {
    constructor() {
      this.value = 1;
    }
  }

  const unsupported = [
    undefined,
    1n,
    Symbol('x'),
    () => {},
    new Date('2026-07-13T00:00:00.000Z'),
    Buffer.from('x'),
    new Map(),
    new Set(),
    new Example()
  ];

  for (const value of unsupported) {
    assert.throws(() => canonicalize(value), /Canonical JSON error/);
  }
});

test('canonicalize rejects sparse arrays and arrays with custom properties', () => {
  const sparse = [];
  sparse[1] = 'x';
  const custom = ['x'];
  custom.extra = true;

  assert.throws(() => canonicalize(sparse), /sparse arrays/);
  assert.throws(() => canonicalize(custom), /custom properties/);
});

test('canonicalize rejects circular references', () => {
  const value = { a: 1 };
  value.self = value;

  assert.throws(() => canonicalize(value), /circular references/);
});

test('canonicalize does not execute toJSON', () => {
  const value = {
    a: 1,
    toJSON() {
      throw new Error('toJSON executed');
    }
  };

  assert.throws(() => canonicalize(value), /function is not supported/);
});

test('canonicalize rejects non-enumerable, accessor, and symbol properties', () => {
  const nonEnumerable = {};
  Object.defineProperty(nonEnumerable, 'hidden', { value: 1, enumerable: false });

  const accessor = {};
  Object.defineProperty(accessor, 'x', {
    enumerable: true,
    get() {
      throw new Error('getter executed');
    }
  });

  const symbolKeyed = { a: 1 };
  symbolKeyed[Symbol('s')] = 2;

  assert.throws(() => canonicalize(nonEnumerable), /non-enumerable/);
  assert.throws(() => canonicalize(accessor), /accessor/);
  assert.throws(() => canonicalize(symbolKeyed), /symbol properties/);
});

test('canonicalize returns byte-identical output for same semantic object', () => {
  const first = {};
  first.b = [2, 1];
  first.a = { y: 'e\u0301', x: null };

  const second = {};
  second.a = { x: null, y: '\u00e9' };
  second.b = [2, 1];

  assert.equal(canonicalize(first), canonicalize(second));
});

test('sha256Hex matches a known SHA-256 vector', () => {
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

test('sha256Hex accepts Buffer and rejects other inputs', () => {
  assert.equal(
    sha256Hex(Buffer.from('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.throws(() => sha256Hex(123), /string or Buffer/);
});

test('hashCanonical is deterministic despite object insertion order', () => {
  assert.equal(
    hashCanonical('cand:v1:', { b: 2, a: 1 }),
    hashCanonical('cand:v1:', { a: 1, b: 2 })
  );
});

test('hashCanonical domain separation produces different hashes', () => {
  assert.notEqual(
    hashCanonical('cand:v1:', { a: 1 }),
    hashCanonical('run:v1:', { a: 1 })
  );
});

test('hashId applies prefix and length', () => {
  const id = hashId('cand_', 'cand:v1:', { a: 1 }, 12);

  assert.match(id, /^cand_[a-f0-9]{12}$/);
  assert.equal(id, `cand_${hashCanonical('cand:v1:', { a: 1 }).slice(0, 12)}`);
});

test('hashing rejects invalid arguments', () => {
  assert.throws(() => hashCanonical('', { a: 1 }), /domainTag/);
  assert.throws(() => hashCanonical(1, { a: 1 }), /domainTag/);
  assert.throws(() => hashId(1, 'cand:v1:', {}, 8), /prefix/);
  assert.throws(() => hashId('x_', 'cand:v1:', {}, 7), /length/);
  assert.throws(() => hashId('x_', 'cand:v1:', {}, 65), /length/);
  assert.throws(() => hashId('x_', 'cand:v1:', {}, 8.5), /length/);
});

test('path safety detects same, nested, and sibling paths correctly', () => {
  const root = makeTempDir();
  const raw = path.join(root, 'raw');
  const rawChild = path.join(raw, 'child', 'file.txt');
  const raw2 = path.join(root, 'raw2', 'file.txt');

  assert.equal(isSamePathOrContained(raw, raw), true);
  assert.equal(isSamePathOrContained(raw, rawChild), true);
  assert.equal(isSamePathOrContained(raw, raw2), false);
});

test('path safety resolves "." and ".." before comparison', () => {
  const root = makeTempDir();
  const base = path.join(root, 'base');
  const child = path.join(base, '.', 'nested', '..', 'file.txt');

  assert.equal(isSamePathOrContained(base, child), true);
});

test('normalizeForComparison resolves absolute paths and normalizes case on Windows', () => {
  const root = makeTempDir();
  const target = path.join(root, 'CasePath');
  const normalized = normalizeForComparison(path.join(target, '.', 'child', '..'));

  assert.equal(path.isAbsolute(normalized), true);
  if (process.platform === 'win32') {
    assert.equal(normalized, normalized.toLowerCase());
  }
});

test('resolveInside rejects absolute paths, traversal, and null bytes', () => {
  const root = makeTempDir();

  assert.equal(resolveInside(root, path.join('nested', '..', 'file.txt')), path.join(root, 'file.txt'));
  assert.throws(() => resolveInside(root, path.resolve(root, 'file.txt')), /must not be absolute/);
  assert.throws(() => resolveInside(root, path.join('..', 'escape.txt')), /escapes baseDir/);
  assert.throws(() => resolveInside(root, 'bad\0path'), /null bytes/);
});

test('path safety compares case-insensitively on Windows only', t => {
  if (process.platform !== 'win32') {
    t.skip('case-insensitive path comparison applies to Windows only');
    return;
  }

  const root = makeTempDir();
  const parent = path.join(root, 'RAW');
  const child = path.join(root, 'raw', 'file.txt');

  assert.equal(isSamePathOrContained(parent, child), true);
});

test('assertOutside rejects forbidden directories and allows outside paths', () => {
  const root = makeTempDir();
  const forbidden = path.join(root, 'raw');

  assert.throws(
    () => assertOutside(path.join(forbidden, 'file.txt'), [forbidden]),
    /forbidden directory/
  );
  assert.throws(() => assertOutside(forbidden, [forbidden]), /forbidden directory/);
  assert.equal(
    assertOutside(path.join(root, 'raw2', 'file.txt'), [forbidden]),
    path.resolve(root, 'raw2', 'file.txt')
  );
});

test('assertNoSymlink allows a non-existent final target when ancestors are safe', () => {
  const root = makeTempDir();

  assert.equal(
    assertNoSymlink(path.join(root, 'safe', 'new-file.txt'), { checkAncestors: true }),
    path.resolve(root, 'safe', 'new-file.txt')
  );
});

test('assertNoSymlink rejects symlink target where supported', t => {
  const root = makeTempDir();
  const target = path.join(root, 'target-dir');
  const link = path.join(root, 'link-dir');
  fs.mkdirSync(target);

  if (!makeDirLink(target, link)) {
    t.skip('symlink and junction creation not permitted on this system');
    return;
  }

  assert.throws(() => assertNoSymlink(link), /must not be a symlink/);
});

test('canonicalize sorts keys by their NFC form, not the original form', () => {
  // Decomposed "éx" sorts before composed "éa" by original code
  // units, but after it once both keys are NFC-normalized.
  const decomposedKeys = { 'éx': 1, 'éa': 2 };
  const composedKeys = { 'éx': 1, 'éa': 2 };

  assert.equal(canonicalize(decomposedKeys), '{"éa":2,"éx":1}');
  assert.equal(canonicalize(decomposedKeys), canonicalize(composedKeys));
});

test('canonicalize rejects distinct keys that collide after NFC normalization', () => {
  const value = { 'é': 1, 'é': 2 };

  assert.equal(Object.keys(value).length, 2);
  assert.throws(() => canonicalize(value), /collide after NFC normalization/);
});

test('canonicalize rejects integers outside the safe integer range', () => {
  for (const value of [2 ** 53, -(2 ** 53), 1e21, -1e21]) {
    assert.throws(() => canonicalize(value), /safe integer range/);
  }
  assert.equal(
    canonicalize(Number.MAX_SAFE_INTEGER),
    '9007199254740991'
  );
  assert.equal(
    canonicalize(Number.MIN_SAFE_INTEGER),
    '-9007199254740991'
  );
});

test('canonicalize serializes negative zero as 0', () => {
  assert.equal(canonicalize(-0), '0');
  assert.equal(canonicalize({ n: -0 }), canonicalize({ n: 0 }));
});

test('canonicalize escapes backspace and form feed', () => {
  assert.equal(canonicalize({ text: '\b\f' }), '{"text":"\\b\\f"}');
});

test('canonicalize escapes lone surrogates deterministically', () => {
  assert.equal(canonicalize({ s: '\ud800' }), '{"s":"\\ud800"}');
  assert.equal(canonicalize({ s: '\udfff' }), '{"s":"\\udfff"}');
});

test('canonicalize passes supplementary characters through unescaped', () => {
  assert.equal(canonicalize({ s: '😀' }), '{"s":"😀"}');
});

test('canonicalize accepts null-prototype objects', () => {
  const value = Object.assign(Object.create(null), { b: 2, a: 1 });

  assert.equal(canonicalize(value), '{"a":1,"b":2}');
});

test('canonicalize allows repeated non-circular references', () => {
  const shared = { x: 1 };
  const value = { a: shared, b: shared, c: [shared] };

  assert.equal(canonicalize(value), '{"a":{"x":1},"b":{"x":1},"c":[{"x":1}]}');
});

test('canonicalize rejects cross-realm plain objects', () => {
  const crossRealm = vm.runInNewContext('({ a: 1 })');

  assert.throws(() => canonicalize(crossRealm), /only plain objects/);
});

test('hashing enforces the domain tag pattern', () => {
  const invalidTags = [
    'x',
    'x1',
    'cand:v1',
    'Cand:v1:',
    'a b:',
    'a"b:',
    'a\nb:',
    ':',
    'a::b:',
    `${'a'.repeat(64)}:`
  ];

  for (const tag of invalidTags) {
    assert.throws(() => hashCanonical(tag, { a: 1 }), /domainTag/);
  }

  assert.match(hashCanonical('cand:v1:', { a: 1 }), /^[a-f0-9]{64}$/);
  assert.match(hashCanonical('run.v2_x:', { a: 1 }), /^[a-f0-9]{64}$/);
});

test('hashing rejects the tags that made concatenation ambiguous', () => {
  // Without the trailing-":" rule, "x" + canonicalize(12) and
  // "x1" + canonicalize(2) hash the same bytes ("x12").
  assert.throws(() => hashCanonical('x', 12), /domainTag/);
  assert.throws(() => hashCanonical('x1', 2), /domainTag/);
});

test('sha256Hex hashes strings as UTF-8 bytes', () => {
  const thai = 'สวัสดี';

  assert.equal(sha256Hex(thai), sha256Hex(Buffer.from(thai, 'utf8')));
});

test('resolveInside rejects Windows-style absolute paths on every platform', () => {
  const root = makeTempDir();

  for (const absolute of ['C:\\x', 'C:/x', '\\\\srv\\share\\x', '/abs/x']) {
    assert.throws(() => resolveInside(root, absolute), /must not be absolute/);
  }
});

test('path safety rejects Windows device path syntax', () => {
  assert.throws(() => normalizeForComparison('\\\\?\\C:\\x'), /device path/);
  assert.throws(() => normalizeForComparison('\\\\.\\C:\\x'), /device path/);
  assert.throws(() => normalizeForComparison('//?/C:/x'), /device path/);
  assert.throws(
    () => assertOutside('\\\\?\\C:\\raw\\f', ['C:\\raw']),
    /device path/
  );
});

test('path safety rejects empty path strings', () => {
  const root = makeTempDir();

  assert.throws(() => normalizeForComparison(''), /must not be empty/);
  assert.throws(() => resolveInside('', 'x'), /must not be empty/);
  assert.throws(() => resolveInside(root, ''), /must not be empty/);
  assert.throws(() => assertOutside('', []), /must not be empty/);
  assert.throws(() => assertNoSymlink(''), /must not be empty/);
});

test('assertNoSymlink rejects broken symlinks as target and ancestor', t => {
  const root = makeTempDir();
  const target = path.join(root, 'vanishing-dir');
  const broken = path.join(root, 'broken');
  fs.mkdirSync(target);

  if (!makeDirLink(target, broken)) {
    t.skip('symlink and junction creation not permitted on this system');
    return;
  }

  fs.rmdirSync(target);
  assert.equal(fs.existsSync(broken), false);

  assert.throws(() => assertNoSymlink(broken), /must not be a symlink/);
  assert.throws(
    () => assertNoSymlink(path.join(broken, 'child.txt'), { checkAncestors: true }),
    /ancestor/
  );
});

test('assertNoSymlink rejects symlink ancestors where supported', t => {
  const root = makeTempDir();
  const realDir = path.join(root, 'real');
  const linkDir = path.join(root, 'link-ancestor');
  fs.mkdirSync(realDir, { recursive: true });

  if (!makeDirLink(realDir, linkDir)) {
    t.skip('symlink and junction creation not permitted on this system');
    return;
  }

  assert.throws(
    () => assertNoSymlink(path.join(linkDir, 'future.txt'), { checkAncestors: true }),
    /ancestor/
  );
});
