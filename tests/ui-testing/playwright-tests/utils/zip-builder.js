// Minimal in-memory ZIP builder (stored / no compression).
// --------------------------------------------------------------------------
// Kept dependency-free so tests need no extra npm packages. Used to generate
// sourcemap upload archives at TEST TIME from committed, diffable text
// fixtures — no opaque .zip binaries are committed to the repo.
// Shared by GeneralTests/rum-form-validation.spec.js and the RUM sourcemap
// specs.

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * CRC-32 (IEEE) of a Buffer — needed to build a spec-compliant ZIP entry.
 * @param {Buffer} buf
 * @returns {number} unsigned 32-bit CRC
 */
function crc32(buf) {
  let table = crc32._table;
  if (!table) {
    table = crc32._table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

/**
 * Build a structurally valid ZIP archive in memory.
 * @param {Array<{name: string, content: string|Buffer}>} files
 * @returns {Buffer} the complete ZIP archive
 */
function buildZip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4);         // version needed
    local.writeUInt16LE(0, 6);          // flags
    local.writeUInt16LE(0, 8);          // method: stored
    local.writeUInt16LE(0, 10);         // mod time
    local.writeUInt16LE(0, 12);         // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);         // extra length
    localChunks.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir header signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0, 8);          // flags
    central.writeUInt16LE(0, 10);         // method: stored
    central.writeUInt16LE(0, 12);         // mod time
    central.writeUInt16LE(0, 14);         // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra length
    central.writeUInt16LE(0, 32);         // comment length
    central.writeUInt16LE(0, 34);         // disk number start
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0, 38);         // external attrs
    central.writeUInt32LE(offset, 42);    // local header offset
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4);          // disk number
  eocd.writeUInt16LE(0, 6);          // disk with central dir
  eocd.writeUInt16LE(files.length, 8);  // entries this disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(centralBuf.length, 12); // central dir size
  eocd.writeUInt32LE(offset, 16);            // central dir offset
  eocd.writeUInt16LE(0, 20);         // comment length

  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

/**
 * Create a temporary file on disk and return its absolute path.
 * @param {string} filename - File name including extension
 * @param {string|Buffer} [content] - Optional content (defaults to empty)
 * @returns {string} absolute path to the temp file
 */
function createTempFile(filename, content = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rum-zip-'));
  const file = path.join(dir, filename);
  fs.writeFileSync(file, content);
  return file;
}

/**
 * Build a ZIP from files and write it to a temp path (for UI file inputs).
 * @param {string} zipName
 * @param {Array<{name: string, content: string|Buffer}>} files
 * @returns {string} absolute path to the generated zip
 */
function writeTempZip(zipName, files) {
  return createTempFile(zipName, buildZip(files));
}

module.exports = { crc32, buildZip, createTempFile, writeTempZip };
