const { body } = require("express-validator");

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
];
