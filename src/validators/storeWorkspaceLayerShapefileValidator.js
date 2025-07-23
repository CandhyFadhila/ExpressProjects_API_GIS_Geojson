const { body } = require("express-validator");

exports.storeWorkspaceLayerShapefileValidator = [
  body("workspace_id")
    .notEmpty()
    .withMessage("ID workspace tidak boleh kosong.")
    .bail()
    .isInt({ gt: 0 })
    .withMessage("ID workspace harus berupa angka bulat positif."),
];
