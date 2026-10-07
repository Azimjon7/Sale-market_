const fs = require("fs");
const path = require("path");

/**
 * Read a JSON file safely.
 * Returns defaultValue if the file is absent or contains invalid JSON.
 * Logs a warning on parse failure (but not on a simple missing file).
 *
 * @param {string} filePath        Absolute path to the JSON file.
 * @param {Array|Object} defaultValue Returned when file is missing or corrupt.
 * @returns {Array|Object}
 */
function readJSON(filePath, defaultValue = []) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(`[jsonStore] Failed to parse ${filePath}: ${err.message}. Using default.`);
    }
    return defaultValue;
  }
}

/**
 * Write data to a JSON file atomically (write tmp -> rename).
 * Validates that data is a serialisable array/object before writing.
 * Throws on failure so callers can catch and return HTTP 500.
 *
 * @param {string} filePath  Absolute path to the JSON file.
 * @param {Array|Object} data Data to serialise and write.
 */
function writeJSON(filePath, data) {
  if (data === null || typeof data !== "object") {
    throw new Error("writeJSON: data must be an array or object");
  }

  const dir = path.dirname(filePath);
  const tmp = filePath + ".tmp";
  const serialised = JSON.stringify(data, null, 2);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, serialised, "utf8");

  try {
    fs.renameSync(tmp, filePath);
  } catch (renameErr) {
    // Windows: destination exists -> unlink then retry
    try {
      fs.unlinkSync(filePath);
      fs.renameSync(tmp, filePath);
    } catch (retryErr) {
      try {
        fs.unlinkSync(tmp);
      } catch {}
      throw retryErr;
    }
  }
}

module.exports = { readJSON, writeJSON };
