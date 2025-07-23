const { body } = require("express-validator");

exports.updateWorkspaceValidator = [
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

  body("delete_document_ids")
    .optional()
    .isArray()
    .withMessage("Format ID dokumen yang dihapus harus berupa array."),

  body("delete_document_ids.*")
    .optional()
    .isNumeric()
    .withMessage("Setiap ID dokumen yang dihapus harus berupa angka."),
];
