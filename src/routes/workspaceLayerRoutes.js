const express = require("express");
const router = express.Router();
const workspaceLayerController = require("../controllers/workspacelayerController");
const {
  storeWorkspaceLayerShapefileValidator,
} = require("../validators/storeWorkspaceLayerShapefileValidator");
const validate = require("../middlewares/validate");
const authMiddleware = require("../middlewares/authMiddleware");
const rateLimiter = require("../middlewares/rateLimitMiddleware");
const upload = require("../middlewares/multerMiddleware");

router.patch(
  "/upload-shapefile",
  rateLimiter,
  authMiddleware,
  upload.array("shapefile", 1),
  storeWorkspaceLayerShapefileValidator,
  validate,
  workspaceLayerController.storeShapeFile
);

router.get(
  "/shape-files/:workspace_id",
  workspaceLayerController.getAllShapeFilesByWorkspaceId
);

module.exports = router;
