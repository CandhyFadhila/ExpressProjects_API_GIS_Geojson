const express = require("express");
const router = express.Router();
const layersController = require("../../controllers/Layers/layersController");
const validate = require("../../middlewares/validate");
const {
  storeLayerValidator,
} = require("../../validators/Layers/storeLayerValidator");
const {
  updateLayerValidator,
} = require("../../validators/Layers/updateLayerValidator");
const authMiddleware = require("../../middlewares/authMiddleware");
const rateLimiter = require("../../middlewares/rateLimitMiddleware");
const upload = require("../../middlewares/multerMiddleware");

router.post(
  "/create",
  rateLimiter,
  authMiddleware,
  upload.array("file", 1),
  storeLayerValidator,
  validate,
  layersController.store
);

router.patch(
  "/update/:id",
  rateLimiter,
  authMiddleware,
  upload.array("file", 1),
  updateLayerValidator,
  validate,
  layersController.update
);

router.delete(
  "/delete/:id",
  rateLimiter,
  authMiddleware,
  layersController.destroy
);

module.exports = router;