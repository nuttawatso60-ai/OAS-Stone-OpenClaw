#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  loadSchema,
  compileSchema,
  validateDocument,
  formatValidationErrors
} = require('./lib/extraction/schema_validator');
const { assertNoSymlink, assertOutside } = require('./lib/extraction/path_safety');

const WORKSPACE_DIR = path.resolve(__dirname, '..');
const DEFAULT_INPUT_PATH = path.join(
  WORKSPACE_DIR, 'knowledge', 'datasets', 'drafts', 'processed_conversations.json'
);
const DEFAULT_OUTPUT_PATH = path.join(WORKSPACE_DIR, 'knowledge', 'datasets', 'chat_index.json');
const PROCESSED_SCHEMA_PATH = path.join(
  WORKSPACE_DIR, 'knowledge', 'datasets', 'schemas', 'processed_conversations.schema.json'
);
const INDEX_SCHEMA_PATH = path.join(
  WORKSPACE_DIR, 'knowledge', 'datasets', 'schemas', 'chat_index.schema.json'
);

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read processed conversations: ${filePath}`);
  }
}

function validateInput(document) {
  const result = validateDocument(document, compileSchema(loadSchema(PROCESSED_SCHEMA_PATH)));
  if (!result.valid) {
    throw new Error(`Processed conversations failed schema validation: ${formatValidationErrors(result.errors)}`);
  }
  return document;
}

function compareSourceRefs(left, right) {
  return left.localeCompare(right, 'en', { sensitivity: 'variant' });
}

function sanitizeSourceRef(sourceRef) {
  return sourceRef.replace(/[^A-Za-z0-9._/-]+/g, '_');
}

function chunkId(sourceRef, sequence) {
  return `${sanitizeSourceRef(sourceRef)}:${String(sequence).padStart(4, '0')}`;
}

function buildChatIndex(document) {
  validateInput(document);
  const seenSourceRefs = new Set();
  const items = [...document.items]
    .sort((left, right) => compareSourceRefs(left.source_ref, right.source_ref))
    .map((record, index) => {
      if (seenSourceRefs.has(record.source_ref)) {
        throw new Error(`Duplicate processed conversation source_ref: ${record.source_ref}`);
      }
      seenSourceRefs.add(record.source_ref);
      const indexes = record.messages.map(message => message.index);
      const messageRange = indexes.length === 0
        ? { start: 0, end: 0 }
        : { start: Math.min(...indexes), end: Math.max(...indexes) };
      if (messageRange.end < messageRange.start) {
        throw new Error(`Invalid message range for source_ref: ${record.source_ref}`);
      }
      return {
        id: chunkId(record.source_ref, index + 1),
        source_ref: record.source_ref,
        content_sha256: record.content_sha256,
        message_range: messageRange,
        tags: [],
        search_terms: [],
        status: record.status === 'normalized' && indexes.length > 0 ? 'indexed' : 'unparsed'
      };
    });

  const output = { schema_version: '1.0', items };
  const result = validateDocument(output, compileSchema(loadSchema(INDEX_SCHEMA_PATH)));
  if (!result.valid) {
    throw new Error(`Chat index failed schema validation: ${formatValidationErrors(result.errors)}`);
  }
  return output;
}

function writeJsonAtomic(filePath, document) {
  const outputPath = assertOutside(filePath, [
    path.join(WORKSPACE_DIR, 'knowledge', 'raw'),
    path.join(WORKSPACE_DIR, 'knowledge', 'processed')
  ]);
  assertNoSymlink(outputPath, { checkAncestors: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tempPath, outputPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function main(argv = process.argv.slice(2)) {
  const inputPath = argv[0] || DEFAULT_INPUT_PATH;
  const outputPath = argv[1] || DEFAULT_OUTPUT_PATH;
  const index = buildChatIndex(readJson(inputPath));
  writeJsonAtomic(outputPath, index);
  console.log(`Indexed ${index.items.length} chat chunk(s).`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Chat index error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_INPUT_PATH,
  DEFAULT_OUTPUT_PATH,
  buildChatIndex,
  chunkId
};
