const express = require("express");
const router = express.Router();
const workspaceController = require("../controllers/workspaceController");
const validate = require("../middlewares/validate");
const {
  storeWorkspaceValidator,
} = require("../validators/storeWorkspaceValidator");
const {
  updateWorkspaceValidator,
} = require("../validators/updateWorkspaceValidator");
const authMiddleware = require("../middlewares/authMiddleware");
const rateLimiter = require("../middlewares/rateLimitMiddleware");
const upload = require("../middlewares/multerMiddleware");

router.get(
  "/index",
  rateLimiter,
  authMiddleware,
  workspaceController.index
);

router.get(
  "/show/:id",
  rateLimiter,
  authMiddleware,
  workspaceController.show
);

router.post(
  "/create",
  rateLimiter,
  authMiddleware,
  upload.array("thumbnail", 1),
  storeWorkspaceValidator,
  validate,
  workspaceController.store
);

router.patch(
  "/update/:id",
  rateLimiter,
  authMiddleware,
  upload.array("thumbnail", 1),
  updateWorkspaceValidator,
  validate,
  workspaceController.update
);

router.delete(
  "/delete/:id",
  rateLimiter,
  authMiddleware,
  workspaceController.destroy
);

router.patch(
  "/restore/:id",
  rateLimiter,
  authMiddleware,
  workspaceController.restore
);

module.exports = router;
