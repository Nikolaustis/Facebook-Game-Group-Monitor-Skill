const fs = require('fs');
const path = require('path');

function decodeTextBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || '');
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf8-bom' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString('utf16le'), encoding: 'utf16le-bom' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const body = Buffer.from(buffer.subarray(2));
    for (let i = 0; i + 1 < body.length; i += 2) {
      const first = body[i];
      body[i] = body[i + 1];
      body[i + 1] = first;
    }
    return { text: body.toString('utf16le'), encoding: 'utf16be-bom' };
  }

  // PowerShell and redirected native output can occasionally create UTF-16LE
  // without an explicit BOM. Detect a strong NUL-byte pattern before falling
  // back to UTF-8. JSON itself contains almost no NUL characters.
  const sampleLength = Math.min(buffer.length, 512);
  let oddNuls = 0;
  let evenNuls = 0;
  let oddSlots = 0;
  let evenSlots = 0;
  for (let i = 0; i < sampleLength; i++) {
    if (i % 2 === 0) {
      evenSlots++;
      if (buffer[i] === 0) evenNuls++;
    } else {
      oddSlots++;
      if (buffer[i] === 0) oddNuls++;
    }
  }
  if (oddSlots && oddNuls / oddSlots > 0.35 && evenNuls / Math.max(1, evenSlots) < 0.1) {
    return { text: buffer.toString('utf16le'), encoding: 'utf16le-detected' };
  }

  return { text: buffer.toString('utf8').replace(/^\uFEFF/, ''), encoding: 'utf8' };
}

function readTextAuto(file) {
  const resolved = path.resolve(String(file));
  const decoded = decodeTextBuffer(fs.readFileSync(resolved));
  return { ...decoded, file: resolved };
}

function buildJsonReadError(file, encoding, err, text) {
  const preview = String(text || '')
    .slice(0, 120)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, '?');
  const message = err && err.message ? err.message : String(err);
  const wrapped = new Error(`Invalid JSON: ${file} (detected ${encoding}): ${message}; preview=${JSON.stringify(preview)}`);
  wrapped.code = 'INVALID_JSON_INPUT';
  wrapped.file = file;
  wrapped.detectedEncoding = encoding;
  wrapped.cause = err;
  return wrapped;
}

function readJsonFile(file, options = {}) {
  const { allowMissing = false, defaultValue = null } = options;
  const resolved = path.resolve(String(file));
  if (!fs.existsSync(resolved)) {
    if (allowMissing) return defaultValue;
    const err = new Error(`JSON file does not exist: ${resolved}`);
    err.code = 'JSON_FILE_MISSING';
    err.file = resolved;
    throw err;
  }
  const { text, encoding } = readTextAuto(resolved);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw buildJsonReadError(resolved, encoding, err, text);
  }
}

function writeTextUtf8NoBom(file, text) {
  const resolved = path.resolve(String(file));
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, String(text ?? ''), { encoding: 'utf8' });
}

function writeJsonAtomic(file, value, space = 2) {
  const resolved = path.resolve(String(file));
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmp = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, space), { encoding: 'utf8' });
  fs.renameSync(tmp, resolved);
}

module.exports = {
  decodeTextBuffer,
  readTextAuto,
  readJsonFile,
  writeTextUtf8NoBom,
  writeJsonAtomic,
};
