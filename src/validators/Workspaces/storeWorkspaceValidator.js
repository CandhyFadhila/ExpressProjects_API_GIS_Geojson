const { body } = require("express-validator");
const knex = require("../../config/database");

exports.storeWorkspaceValidator = [
  body("title")
    .notEmpty()
    .withMessage("Judul workspace tidak boleh kosong.")
    .bail()
    .isString()
    .withMessage("Judul workspace harus berupa teks.")
    .bail()
    .isLength({ max: 255 })
    .withMessage("Judul workspace maksimal 255 karakter."),

  body("description")
    .notEmpty()
    .withMessage("Deskripsi workspace tidak boleh kosong.")
    .bail()
    .isString()
    .withMessage("Deskripsi workspace harus berupa teks."),

  body("category_id")
    .notEmpty()
    .withMessage("Kategori workspace wajib dipilih.")
    .bail()
    .isInt()
    .withMessage("Kategori workspace harus berupa angka.")
    .bail()
    .custom(async (value) => {
      const category = await knex("workspace_categories")
        .where("id", value)
        .first();
      if (!category) {
        throw new Error("Kategori workspace yang Anda pilih tidak ditemukan.");
      }
      return true;
    }),
];
