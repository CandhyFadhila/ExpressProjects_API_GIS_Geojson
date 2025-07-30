const { body } = require("express-validator");
const knex = require("../../config/database");

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

  body("table_name")
    .optional()
    .isString()
    .withMessage("Nama tabel harus berupa teks.")
    .isLength({ max: 63 })
    .withMessage("Nama tabel maksimal 63 karakter.")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage(
      "Nama tabel hanya boleh mengandung huruf, angka, dan underscore."
    )
    .bail()
    .custom(async (value, { req }) => {
      if (!value) return true;

      const currentId = parseInt(req.params.id);

      // 1. Cek apakah sudah digunakan di layer lain
      const usedInOther = await knex("layers")
        .where("table_name", value)
        .whereNot("id", currentId)
        .whereNull("deleted_at")
        .first();

      if (usedInOther) {
        throw new Error("Nama tabel sudah digunakan oleh layer lain.");
      }

      // 2. Cek apakah tabel fisik ada di DB dan bukan milik current layer
      const currentLayer = await knex("layers").where("id", currentId).first();
      if (!currentLayer) {
        throw new Error("Data layer tidak ditemukan.");
      }

      const result = await knex.raw(`SELECT to_regclass('${value}') as exists`);
      const existsInDb = result.rows[0].exists !== null;

      // Jika table_name diubah dan nama baru sudah ada di DB, tolak
      if (value !== currentLayer.table_name && existsInDb) {
        throw new Error(
          "Nama tabel sudah ada di database. Silakan gunakan nama lain."
        );
      }

      return true;
    }),
];
