const express = require("express");
const router = express.Router();
const categoriesController = require("../../../src/controllers/MasterData/Categories/categoriesController");
const validate = require("../../middlewares/validate");
const {
  storeCategoriesValidator,
} = require("../../validators/Categories/storeCategories");
const {
  updateCategoriesValidator,
} = require("../../validators/Categories/updateCategories");
const authMiddleware = require("../../middlewares/authMiddleware");
const rateLimiter = require("../../middlewares/rateLimitMiddleware");
const multer = require("multer");
const upload = multer();

router.get(
  "/index",
  rateLimiter,
  authMiddleware,
  categoriesController.index
);

router.get(
  "/show/:id",
  rateLimiter,
  authMiddleware,
  categoriesController.show
);

router.post(
  "/create",
  upload.none(),
  rateLimiter,
  authMiddleware,
  storeCategoriesValidator,
  validate,
  categoriesController.store
);

router.patch(
  "/update/:id",
  upload.none(),
  rateLimiter,
  authMiddleware,
  updateCategoriesValidator,
  validate,
  categoriesController.update
);

router.delete(
  "/delete/:id",
  rateLimiter,
  authMiddleware,
  categoriesController.destroy
);

router.patch(
  "/restore/:id",
  rateLimiter,
  authMiddleware,
  categoriesController.restore
);

module.exports = router;