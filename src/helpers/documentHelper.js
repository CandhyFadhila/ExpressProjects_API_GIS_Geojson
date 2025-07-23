const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const crypto = require("crypto");
const knex = require("../config/database");
const logger = require("../utils/logger");

function generateRandomString(length = 25) {
  return crypto
    .randomBytes(length)
    .toString("base64")
    .replace(/\W/g, "")
    .substring(0, length);
}

function formatFileSize(bytes) {
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 B";
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

async function uploadDocuments(files, uploadedBy, verifiedBy = 1) {
  const uploadedResults = [];

  // Buat direktori target sekali di awal
  const destinationDir = path.join(
    __dirname,
    "..",
    "public",
    "storage",
    "documents"
  );

  try {
    if (!fs.existsSync(destinationDir)) {
      fs.mkdirSync(destinationDir, { recursive: true });
      logger.info(`| uploadDocuments | - Folder dibuat: ${destinationDir}`);
    }
  } catch (err) {
    logger.error(`| uploadDocuments | - Gagal membuat folder: ${err.message}`);
    throw new Error("Gagal menyiapkan direktori penyimpanan dokumen.");
  }

  // Proses masing-masing file
  for (const file of files) {
    try {
      const extension = path.extname(file.originalname);
      const randomName = generateRandomString() + extension;
      const destinationPath = path.join(destinationDir, randomName);

      fs.renameSync(file.path, destinationPath); // move file

      const relativePath = `storage/documents/${randomName}`;
      const fileUrl = `${process.env.APP_URL}/${relativePath}`;
      const mimeType = file.mimetype;
      const fileSize = formatFileSize(file.size);
      const fileId = uuidv4();

      const result = await knex("documents")
        .insert({
          uploaded_by: uploadedBy,
          verified_by: verifiedBy,
          file_id: fileId,
          file_name: randomName,
          file_path: relativePath,
          file_url: fileUrl,
          file_mime_type: mimeType,
          file_size: fileSize,
        })
        .returning(["id", "created_at", "updated_at", "deleted_at"]);

      const inserted = result[0];

      uploadedResults.push({
        id: inserted.id,
        file_id: fileId,
        filename: randomName,
        file_path: relativePath,
        file_url: fileUrl,
        file_mime_type: mimeType,
        file_size: fileSize,
        created_at: inserted.created_at,
        updated_at: inserted.updated_at,
        deleted_at: inserted.deleted_at,
      });

      logger.info(`| uploadDocuments | - Success: ${randomName}`);
    } catch (err) {
      logger.error(
        `| uploadDocuments | - Failed on file ${file.originalname}: ${err.message}`
      );
    }
  }

  return uploadedResults;
}

async function deleteDocuments(documentIds = []) {
  const deleted = [];

  for (const id of documentIds) {
    try {
      const document = await knex("documents")
        .select("file_path")
        .where({ id })
        .whereNull("deleted_at")
        .first();
      if (!document) {
        logger.warn(`| deleteDocuments | - Dokumen ID ${id} tidak ditemukan.`);
        continue;
      }

      const filePath = path.join(__dirname, "..", "public", rows[0].file_path);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      } else {
        logger.warn(
          `| deleteDocuments | - File tidak ditemukan di path: ${filePath}`
        );
      }

      await knex("documents").where({ id }).update({ deleted_at: knex.fn.now() });

      deleted.push(id);
      logger.info(`| deleteDocuments | - Dokumen ${id} berhasil dihapus.`);
    } catch (error) {
      logger.error(
        `| deleteDocuments | - Gagal menghapus dokumen ${id}: ${error.message}`
      );
    }
  }

  return deleted;
}

module.exports = { uploadDocuments, deleteDocuments };
