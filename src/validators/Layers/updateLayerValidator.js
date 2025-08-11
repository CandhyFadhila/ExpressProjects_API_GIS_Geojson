const { body } = require("express-validator");
const knex = require("../../config/database");

// Hex color: #RGB, #RRGGBB, #RRGGBBAA
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Kolom yang dilarang untuk propertyKey
const RESERVED_KEYS = ["layer_id", "document_ids", "color"];

exports.updateLayerValidator = [
  body("workspace_id")
    .optional()
    .isInt()
    .withMessage("Workspace harus berupa angka.")
    .bail()
    .custom(async (value) => {
      if (value !== undefined) {
        const workspace = await knex("workspaces").where("id", value).first();
        if (!workspace) {
          throw new Error("Workspace yang Anda pilih tidak ditemukan.");
        }
      }
      return true;
    }),

  body("parent_layer_id")
    .optional()
    .isInt()
    .withMessage("Parent Layer harus berupa angka.")
    .bail()
    .custom(async (value, { req }) => {
      if (value !== null && value !== undefined) {
        const layer = await knex("layers").where("id", value).first();
        if (!layer) {
          throw new Error("Parent Layer tidak ditemukan.");
        }
        if (parseInt(value) === parseInt(req.params.id)) {
          throw new Error(
            "Layer tidak boleh menjadi parent dari dirinya sendiri."
          );
        }
      }
      return true;
    }),

  body("name")
    .optional()
    .isString()
    .withMessage("Nama layer harus berupa teks.")
    .isLength({ max: 255 })
    .withMessage("Nama layer maksimal 255 karakter."),

  body("description")
    .optional()
    .isString()
    .withMessage("Deskripsi harus berupa teks."),

  body("file_type")
    .optional()
    .isIn(["shp", "geojson"])
    .withMessage("File yang dapat diunggah hanya shapefile atau GeoJSON."),

  body("layer_type")
    .optional()
    .isIn(["fill", "line"])
    .withMessage("Tipe layer yang boleh digunakan hanya fill atau line."),

  body("table_name")
    .optional()
    .isString()
    .withMessage("Nama tabel harus berupa teks.")
    .isLength({ max: 63 })
    .withMessage("Nama tabel maksimal 63 karakter.")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage(
      "Nama tabel hanya boleh mengandung huruf, angka, dan underscore."
    ),

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
];
