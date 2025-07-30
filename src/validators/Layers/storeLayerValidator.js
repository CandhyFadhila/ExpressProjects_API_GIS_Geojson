const { body } = require("express-validator");
const knex = require("../../config/database");

exports.storeLayerValidator = [
  body("workspace_id")
    .notEmpty()
    .withMessage("Workspace wajib dipilih.")
    .bail()
    .isInt()
    .withMessage("Workspace harus berupa angka.")
    .bail()
    .custom(async (value) => {
      const workspace = await knex("workspaces").where("id", value).first();
      if (!workspace) {
        throw new Error("Workspace yang Anda pilih tidak ditemukan.");
      }
      return true;
    }),

  body("parent_layer_id")
    .optional()
    .isInt()
    .withMessage("Parent Layer harus berupa angka.")
    .bail()
    .custom(async (value) => {
      if (value !== null) {
        const layer = await knex("layers").where("id", value).first();
        if (!layer) {
          throw new Error("Parent Layer tidak ditemukan.");
        }
      }
      return true;
    }),

  body("name")
    .notEmpty()
    .withMessage("Nama layer tidak boleh kosong.")
    .bail()
    .isString()
    .withMessage("Nama layer harus berupa teks.")
    .isLength({ max: 255 })
    .withMessage("Nama layer maksimal 255 karakter."),

  body("description")
    .optional({ nullable: true })
    .isString()
    .withMessage("Deskripsi harus berupa teks."),

  body("file_type")
    .notEmpty()
    .withMessage("Tipe file tidak boleh kosong.")
    .isIn(["shp", "geojson"])
    .withMessage("File yang dapat diunggah hanya shapefile atau GeoJSON."),

  body("layer_type")
    .notEmpty()
    .withMessage("Tipe layer tidak boleh kosong.")
    .isIn(["fill", "line"])
    .withMessage("Tipe layer yang boleh digunakan hanya fill atau line."),

  body("table_name")
    .notEmpty()
    .withMessage("Nama tabel tidak boleh kosong.")
    .bail()
    .isString()
    .withMessage("Nama tabel harus berupa teks.")
    .isLength({ max: 255 })
    .withMessage("Nama tabel maksimal 255 karakter.")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage(
      "Nama tabel hanya boleh mengandung huruf, angka, dan underscore."
    )
    .bail()
    .custom(async (value) => {
      // Cek apakah sudah pernah dipakai di layers
      const usedInLayers = await knex("layers")
        .where("table_name", value)
        .whereNull("deleted_at")
        .first();
      if (usedInLayers) {
        throw new Error("Nama tabel sudah digunakan oleh layer lain.");
      }

      // Cek apakah sudah ada di DB fisik
      const rawQuery = `
        SELECT to_regclass('${value}') as exists
      `;
      const result = await knex.raw(rawQuery);
      const existsInDb = result.rows[0].exists !== null;

      if (existsInDb) {
        throw new Error(
          "Nama tabel sudah ada di database. Silakan gunakan nama lain."
        );
      }

      return true;
    }),
];
