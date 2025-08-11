const { body } = require("express-validator");

// Hex color: #RGB, #RRGGBB, #RRGGBBAA
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Kolom yang dilarang untuk propertyKey
const RESERVED_KEYS = ["id", "geom", "layer_id", "document_ids", "color"];

exports.updateColorLayerValidator = [
  body("propertyKey")
    .optional()
    .isString()
    .withMessage("propertyKey harus berupa teks.")
    .trim()
    .isLength({ min: 1, max: 63 })
    .withMessage("propertyKey maksimal 63 karakter.")
    .matches(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .withMessage(
      "propertyKey hanya boleh berisi huruf/angka/underscore dan tidak boleh diawali angka."
    )
    .custom((value) => {
      if (RESERVED_KEYS.includes(String(value).toLowerCase())) {
        throw new Error(
          "propertyKey tidak boleh menggunakan nama kolom terproteksi (layer_id, document_ids, color)."
        );
      }
      return true;
    }),

  body("colorscale")
    .optional()
    .custom((value) => {
      if (!Array.isArray(value)) {
        throw new Error("colorscale harus berupa array.");
      }
      if (value.length === 0) {
        throw new Error("colorscale tidak boleh kosong.");
      }
      if (value.length > 256) {
        throw new Error("colorscale terlalu panjang (maksimal 256 warna).");
      }
      const allValid = value.every(
        (c) => typeof c === "string" && HEX_RE.test(c)
      );
      if (!allValid) {
        throw new Error(
          "Setiap item colorscale harus string warna hex valid (#RGB, #RRGGBB, atau #RRGGBBAA)."
        );
      }
      return true;
    }),

  body().custom((_, { req }) => {
    const hasKey =
      typeof req.body.propertyKey === "string" &&
      req.body.propertyKey.trim() !== "";
    const hasScale =
      Array.isArray(req.body.colorscale) && req.body.colorscale.length > 0;
    if (hasKey !== hasScale) {
      throw new Error(
        "Jika ingin menerapkan color, 'propertyKey' dan 'colorscale' harus dikirim bersamaan."
      );
    }
    return true;
  }),
];
