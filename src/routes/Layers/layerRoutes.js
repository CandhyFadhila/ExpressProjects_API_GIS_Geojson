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
const {
  updateShpGeoDataValidator,
} = require("../../validators/Layers/updateShpGeoDataValidator");
const authMiddleware = require("../../middlewares/authMiddleware");
const rateLimiter = require("../../middlewares/rateLimitMiddleware");
const upload = require("../../middlewares/multerMiddleware");

router.get(
  "/load/:workspace_id",
  rateLimiter,
  authMiddleware,
  layersController.getLayersbyWorkspaceId
);

router.patch(
  "/update-shp-geo-data",
  rateLimiter,
  authMiddleware,
  upload.array("file", 5),
  updateShpGeoDataValidator,
  validate,
  layersController.updateShapefileData
);

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
