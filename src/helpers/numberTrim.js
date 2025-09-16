// utils/numberTrim.js
const NUMERIC_RE = /^[+-]?\d+(?:\.\d+)?$/;

function trimZeroDecimalString(str) {
  if (typeof str !== "string") return str;
  let s = str.trim();
  if (!NUMERIC_RE.test(s)) return str;

  const sign = s.startsWith("-") ? "-" : "";
  if (sign) s = s.slice(1);

  s = s.replace(/(\.\d*?[1-9])0+$/, "$1"); // buang nol di akhir fraksi
  s = s.replace(/\.0+$/, ""); // fraksi semua nol -> buang titik
  s = s.replace(/^0+(?=\d)/, ""); // buang leading zero integer (kecuali "0.xxx")

  if (s === "" || s === "0") return "0";
  return sign + s;
}

function trimZeroDecimal(
  value,
  { returnType = "string", maxFractionDigits = 12 } = {}
) {
  if (value == null) return value;

  if (typeof value === "number" && Number.isFinite(value)) {
    const s = value.toFixed(maxFractionDigits);
    const out = trimZeroDecimalString(s);
    return returnType === "number" && NUMERIC_RE.test(out) ? Number(out) : out;
  }

  if (typeof value === "string") {
    const out = trimZeroDecimalString(value);
    return returnType === "number" && NUMERIC_RE.test(out) ? Number(out) : out;
  }

  return value;
}

// --- helper: hanya anggap plain object ({} literal) sebagai target rekursi ---
function isPlainObject(obj) {
  if (!obj || typeof obj !== "object") return false;
  const proto = Object.getPrototypeOf(obj);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep trim dengan kontrol:
 * - onlyIfHasDecimalPoint: true => STRING hanya di-trim jika ada '.' (hindari HAK "0202...")
 * - shouldTrim(value, keyPathLast, keyPathArr): predicate opsional per key
 * Catatan: Date, Buffer, dan non-plain objects TIDAK direkursi & TIDAK diubah.
 */
function trimZeroDecimalsDeep(input, opts = {}) {
  const {
    returnType = "string",
    maxFractionDigits = 12,
    onlyIfHasDecimalPoint = true,
    shouldTrim, // (value, key, pathArr) => boolean; return false untuk skip trim
    _path = [], // internal
  } = opts;

  const applyTrim = (val, key) => {
    if (typeof shouldTrim === "function" && shouldTrim(val, key, _path) === false) {
      return val;
    }

    if (typeof val === "string") {
      if (onlyIfHasDecimalPoint && !val.includes(".")) return val;
      if (!NUMERIC_RE.test(val.trim())) return val;
      return trimZeroDecimal(val, { returnType, maxFractionDigits });
    }

    if (typeof val === "number") {
      if (Number.isInteger(val)) return val;
      return trimZeroDecimal(val, { returnType, maxFractionDigits });
    }

    // Non-primitive (Date, Buffer, class instance, dll) -> biarkan
    return val;
  };

  if (Array.isArray(input)) {
    return input.map((v, i) =>
      trimZeroDecimalsDeep(v, { ...opts, _path: _path.concat(String(i)) })
    );
  }

  if (isPlainObject(input)) {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      if (Array.isArray(v) || isPlainObject(v)) {
        out[k] = trimZeroDecimalsDeep(v, { ...opts, _path: _path.concat(k) });
      } else {
        out[k] = applyTrim(v, k);
      }
    }
    return out;
  }

  // Bukan array & bukan plain object: kembalikan apa adanya (menjaga Date, Buffer, dll)
  return applyTrim(input, _path[_path.length - 1]);
}

module.exports = { trimZeroDecimal, trimZeroDecimalsDeep };
