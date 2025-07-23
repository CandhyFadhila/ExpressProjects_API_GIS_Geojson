const { body } = require("express-validator");

exports.storeWorkspaceLayerShapefileValidator = [
  body("workspace_layer_id")
    .notEmpty()
    .withMessage("ID layer workspace tidak boleh kosong.")
    .bail()
    .isInt({ gt: 0 })
    .withMessage("ID layer workspace harus berupa angka bulat positif."),
];
