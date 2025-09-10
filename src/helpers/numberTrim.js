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
    let s = value.toFixed(maxFractionDigits);
    const out = trimZeroDecimalString(s);
    return returnType === "number" && NUMERIC_RE.test(out) ? Number(out) : out;
  }

  if (typeof value === "string") {
    const out = trimZeroDecimalString(value);
    return returnType === "number" && NUMERIC_RE.test(out) ? Number(out) : out;
  }

  return value;
}

/**
 * Deep trim dengan kontrol:
 * - onlyIfHasDecimalPoint: true => untuk STRING, hanya trim jika ada '.' (hindari HAK "0202...")
 * - shouldTrim(value, keyPathLast, keyPathArr): predicate opsional untuk kontrol per key
 */
function trimZeroDecimalsDeep(input, opts = {}) {
  const {
    returnType = "string",
    maxFractionDigits = 12,
    onlyIfHasDecimalPoint = true,
    shouldTrim, // (value, key, pathArr) => boolean
    _path = [], // internal
  } = opts;

  const applyTrim = (val, key) => {
    // predicate khusus user
    if (
      typeof shouldTrim === "function" &&
      shouldTrim(val, key, _path) === false
    ) {
      return val;
    }

    // Hanya trim STRING yang mengandung '.' jika onlyIfHasDecimalPoint=true
    if (typeof val === "string") {
      if (onlyIfHasDecimalPoint && !val.includes(".")) return val;
      // pastikan string angka
      if (!NUMERIC_RE.test(val.trim())) return val;
      return trimZeroDecimal(val, { returnType, maxFractionDigits });
    }

    // Untuk NUMBER: hanya trim jika bukan integer
    if (typeof val === "number") {
      if (Number.isInteger(val)) return val; // biarkan bilangan bulat apa adanya
      return trimZeroDecimal(val, { returnType, maxFractionDigits });
    }

    return val;
  };

  if (Array.isArray(input)) {
    return input.map((v, i) =>
      trimZeroDecimalsDeep(v, { ...opts, _path: _path.concat(String(i)) })
    );
  }

  if (input && typeof input === "object") {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      if (v && typeof v === "object") {
        out[k] = trimZeroDecimalsDeep(v, { ...opts, _path: _path.concat(k) });
      } else {
        out[k] = applyTrim(v, k);
      }
    }
    return out;
  }

  // primitif
  return applyTrim(input, _path[_path.length - 1]);
}

module.exports = { trimZeroDecimal, trimZeroDecimalsDeep };
