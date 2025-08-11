const { validationResult } = require("express-validator");
const knex = require("../../config/database");
const logger = require("../../utils/logger");
const {
  uploadDocuments,
  deleteDocuments,
} = require("../../helpers/documentHelper");
const WithDataResource = require("../../resources/WithDataResource");
const WithoutDataResource = require("../../resources/WithoutDataResource");
const fs = require("fs");
const path = require("path");
const { extractZipShapefile } = require("../../helpers/extractZipShapefile");
const {
  convertShapefileToPostgres,
} = require("../../helpers/convertShapefileToPostgres");
const workspaceResource = require("../../resources/Workspaces/workspaceResource");
const {
  convertShapefileRowsToGeoJSON,
} = require("../../helpers/shapefileToGeoJSONHelper");
const {
  resolveArrayRelations,
} = require("../../helpers/resolveArrayRelations");
const serializeLayer = require("../../resources/Layers/serializeLayer");

exports.store = async (req, res) => {
  const trx = await knex.transaction();
  const {
    workspace_id,
    parent_layer_id,
    name,
    description,
    table_name,
    file_type,
    layer_type,
    with_explanation,
  } = req.body;

  try {
    // 1. Validasi dengan express-validator
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const message = errors
        .array()
        .map((err) => err.msg)
        .join(" ");
      const response = new WithoutDataResource(
        400,
        "FAILED_VALIDATION",
        "Format Data Tidak Sesuai Ketentuan",
        message
      );
      return res.status(400).json(response.toResponse());
    }

    // 1.1 Validasi manual duplikat table_name
    const usedInLayers = await trx("layers")
      .where("table_name", table_name)
      .whereNull("deleted_at")
      .first();
    if (usedInLayers) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "DUPLICATE_LAYER_NAME",
        "Nama Tabel Telah Digunakan",
        "Nama tabel sudah digunakan oleh layer lain. Silakan gunakan nama lain."
      );
      return res.status(400).json(response.toResponse());
    }

    const resultTableNameExists = await trx.raw(
      `SELECT to_regclass(?) AS exists`,
      [table_name]
    );
    const existsInDb = resultTableNameExists.rows[0]?.exists !== null;
    if (existsInDb) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "DUPLICATE_LAYER_NAME",
        "Nama Tabel Sudah Ada di Database",
        "Nama tabel sudah ada di database. Silakan gunakan nama lain."
      );
      return res.status(400).json(response.toResponse());
    }

    // 2. Validasi manual untuk files (req.files)
    if (!req.files || req.files.length === 0) {
      const response = new WithoutDataResource(
        400,
        "FILES_NOT_FOUND",
        "Dokumen Tidak Ditemukan",
        "Dokumen shapefile atau geojson wajib diunggah."
      );
      return res.status(400).json(response.toResponse());
    }
    if (req.files.length > 1) {
      const response = new WithoutDataResource(
        400,
        "MAX_FILES",
        "Terlalu Banyak Dokumen",
        "Maksimal hanya 1 file ZIP yang dapat diunggah."
      );
      return res.status(400).json(response.toResponse());
    }

    for (const file of req.files) {
      const allowedTypes = ["application/zip", "application/x-zip-compressed"];
      const isZipMime = allowedTypes.includes(file.mimetype);
      const isZipExtension =
        path.extname(file.originalname).toLowerCase() === ".zip";

      if (!isZipMime || !isZipExtension) {
        const response = new WithoutDataResource(
          400,
          "INVALID_FILE_TYPE",
          "Tipe Dokumen Salah",
          "File yang diunggah harus berformat .zip dan berisi shapefile."
        );
        return res.status(400).json(response.toResponse());
      }
      if (file.size > 50 * 1024 * 1024) {
        const response = new WithoutDataResource(
          400,
          "FILE_TOO_LARGE",
          "Ukuran Dokumen Terlalu Besar",
          "Ukuran maksimal tiap file adalah 50MB."
        );
        return res.status(400).json(response.toResponse());
      }
    }

    // 3. Upload dokumen (document_id)
    const uploadedDocuments = await uploadDocuments(req.files);
    const document_id = uploadedDocuments[0]?.id;
    const relativePath = uploadedDocuments[0]?.file_path;
    const pathRoot = path.resolve(__dirname, "../../");
    const filePath = path.join(pathRoot, "public", relativePath);

    // 4. Simpan ke tabel layers
    const [newLayer] = await trx("layers")
      .insert({
        workspace_id,
        parent_layer_id: parent_layer_id || null,
        document_id,
        name,
        description,
        table_name,
        layer_type,
        with_explanation,
      })
      .returning("*");

    // 5. Jika tipe file 'shp', ekstrak dan unggah shapefile
    if (file_type === "shp") {
      // 5a. Ekstrak isi ZIP untuk validasi file shapefile
      const { extractPath, fileList } = await extractZipShapefile(filePath);

      // Ambil hanya file .shp, .shx, .dbf dan abaikan folder / file lain
      const validExtensions = [".shp", ".shx", ".dbf"];
      const shapefileComponents = fileList.filter((file) => {
        const ext = path.extname(file).toLowerCase();
        const base = path.basename(file);
        return (
          validExtensions.includes(ext) &&
          !file.includes("__MACOSX") &&
          !base.startsWith("._")
        );
      });

      const foundExtensions = shapefileComponents.map((file) =>
        path.extname(file).toLowerCase()
      );

      const hasSHP = foundExtensions.includes(".shp");
      const hasSHX = foundExtensions.includes(".shx");
      const hasDBF = foundExtensions.includes(".dbf");

      if (!(hasSHP && hasSHX && hasDBF)) {
        // Bersihkan folder temp jika tidak valid
        try {
          fs.rmSync(extractPath, { recursive: true, force: true });
        } catch (err) {
          logger.warn(
            `| Layers | - Gagal menghapus folder temp saat validasi gagal: ${err.message}`
          );
        }

        await trx.rollback();
        const response = new WithoutDataResource(
          400,
          "SHP_NOT_COMPLETE",
          "File Shapefile Tidak Lengkap",
          "File ZIP harus memuat file .shp, .shx, dan .dbf agar valid sebagai shapefile."
        );
        return res.status(400).json(response.toResponse());
      }

      // Ambil file .shp utama dari komponen valid
      const shpFile = shapefileComponents.find((file) => file.endsWith(".shp"));

      await handleShapefileUpload(
        shpFile,
        table_name,
        newLayer.id,
        with_explanation
      );
    } // Catatan, jika tipe file 'geojson', buat fungsi baru lagi

    await trx.commit();

    const savedLayer = await knex("layers").where("id", newLayer.id).first();
    const result = await layersStoreUpdateResource(savedLayer);

    const response = new WithDataResource(
      201,
      "SUCCESS_CREATE_DATA",
      "Berhasil Menyimpan Data",
      `Data layer '${name}' berhasil ditambahkan.`,
      result
    );
    return res.status(201).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
    logger.error(`| Layers | - Error function store: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

exports.update = async (req, res) => {
  const trx = await knex.transaction();
  const {
    workspace_id,
    parent_layer_id,
    name,
    description,
    table_name,
    file_type,
    layer_type,
  } = req.body;
  const id = req.params.id;

  try {
    // 1. Validasi
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const message = errors
        .array()
        .map((err) => err.msg)
        .join(" ");
      const response = new WithoutDataResource(
        400,
        "FAILED_VALIDATION",
        "Format Data Tidak Sesuai Ketentuan",
        message
      );
      return res.status(400).json(response.toResponse());
    }

    // 2. Cek apakah data ada
    const existing = await trx("layers").where("id", id).first();
    if (!existing) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Data layer dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 3. Validasi duplikat hanya jika properties table_name berubah
    if (existing.table_name !== table_name) {
      const usedInLayers = await trx("layers")
        .where("table_name", table_name)
        .whereNull("deleted_at")
        .whereNot("id", id)
        .first();
      if (usedInLayers) {
        await trx.rollback();
        const response = new WithoutDataResource(
          400,
          "DUPLICATE_LAYER_NAME",
          "Nama Tabel Telah Digunakan",
          "Nama tabel sudah digunakan oleh layer lain. Silakan gunakan nama lain."
        );
        return res.status(400).json(response.toResponse());
      }

      const resultTableNameExists = await trx.raw(
        `SELECT to_regclass(?) AS exists`,
        [table_name]
      );
      const existsInDb = resultTableNameExists.rows[0]?.exists !== null;
      if (existsInDb) {
        await trx.rollback();
        const response = new WithoutDataResource(
          400,
          "DUPLICATE_LAYER_NAME",
          "Nama Tabel Sudah Ada di Database",
          "Nama tabel sudah ada di database. Silakan gunakan nama lain."
        );
        return res.status(400).json(response.toResponse());
      }
    }

    // 4. Ambil dokumen sebelumnya
    const oldDocId = existing.document_id;
    let finalDocId = oldDocId;

    // 5. Upload dokumen baru
    let newDocId = null;
    if (req.files && req.files.length > 0) {
      const file = req.files[0];
      const allowedMime = ["application/zip", "application/x-zip-compressed"];
      const ext = path.extname(file.originalname).toLowerCase();

      if (!allowedMime.includes(file.mimetype) || ext !== ".zip") {
        const response = new WithoutDataResource(
          400,
          "INVALID_FILE_TYPE",
          "Tipe File Tidak Valid",
          "File yang diunggah harus berformat .zip dan berisi shapefile."
        );
        return res.status(400).json(response.toResponse());
      }
      if (file.size > 20 * 1024 * 1024) {
        const response = new WithoutDataResource(
          400,
          "FILE_TOO_LARGE",
          "Ukuran File Terlalu Besar",
          "Ukuran maksimal file ZIP adalah 20MB."
        );
        return res.status(400).json(response.toResponse());
      }

      // 🔥 Hapus dokumen lama dan drop tabel lama
      if (oldDocId) {
        await handleDeleteTableWithDocument(existing.table_name, oldDocId);
        finalDocId = null;
      }

      const uploads = await uploadDocuments([file]);
      newDocId = uploads[0]?.id;

      // Ekstrak file ZIP ke tabel_name
      const relativePath = uploads[0]?.file_path;
      const pathRoot = path.resolve(__dirname, "../../");
      const filePath = path.join(pathRoot, "public", relativePath);

      if (file_type === "shp") {
        // 5a. Ekstrak isi ZIP untuk validasi file shapefile
        const { extractPath, fileList } = await extractZipShapefile(filePath);

        // Ambil hanya file .shp, .shx, .dbf dan abaikan folder / file lain
        const validExtensions = [".shp", ".shx", ".dbf"];
        const shapefileComponents = fileList.filter((file) => {
          const ext = path.extname(file).toLowerCase();
          const base = path.basename(file);
          return (
            validExtensions.includes(ext) &&
            !file.includes("__MACOSX") &&
            !base.startsWith("._")
          );
        });

        const foundExtensions = shapefileComponents.map((file) =>
          path.extname(file).toLowerCase()
        );

        const hasSHP = foundExtensions.includes(".shp");
        const hasSHX = foundExtensions.includes(".shx");
        const hasDBF = foundExtensions.includes(".dbf");

        if (!(hasSHP && hasSHX && hasDBF)) {
          // Bersihkan folder temp jika tidak valid
          try {
            fs.rmSync(extractPath, { recursive: true, force: true });
          } catch (err) {
            logger.warn(
              `| Layers | - Gagal menghapus folder temp saat validasi gagal: ${err.message}`
            );
          }

          await trx.rollback();
          const response = new WithoutDataResource(
            400,
            "SHP_NOT_COMPLETE",
            "File Shapefile Tidak Lengkap",
            "File ZIP harus memuat file .shp, .shx, dan .dbf agar valid sebagai shapefile."
          );
          return res.status(400).json(response.toResponse());
        }

        // Ambil file .shp utama dari komponen valid
        const shpFile = shapefileComponents.find((file) =>
          file.endsWith(".shp")
        );

        await handleShapefileUpload(shpFile, table_name, id);
      } // Catatan, jika tipe file 'geojson', buat fungsi baru lagi
    }

    // 7. Finalisasi dokumen
    const document_id = newDocId || finalDocId;

    // 8. Rename tabel fisik jika nama table_name berubah (dan tidak mengganti file)
    const oldTableName = existing.table_name;
    if (oldTableName !== table_name && !(req.files && req.files.length > 0)) {
      const rawRenameQuery = `ALTER TABLE "${oldTableName}" RENAME TO "${table_name}"`;
      try {
        await trx.raw(rawRenameQuery);
        logger.info(
          `| Layers | - Tabel ${oldTableName} berhasil di-rename menjadi ${table_name}`
        );
      } catch (err) {
        await trx.rollback();
        logger.error(`| Layers | - Gagal rename tabel: ${err.message}`);
        const response = new WithoutDataResource(
          500,
          "SERVER_ERROR",
          "Server Sedang Error",
          "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
        );
        return res.status(500).json(response.toResponse());
      }
    }

    // 9. Update ke database
    await trx("layers")
      .where("id", id)
      .update({
        workspace_id,
        parent_layer_id: parent_layer_id || null,
        document_id,
        name,
        description,
        table_name,
        layer_type,
        updated_at: trx.fn.now(),
      });

    // 10. Commit
    await trx.commit();

    const saved = await knex("layers").where("id", id).first();
    const result = await layersStoreUpdateResource(saved);

    const response = new WithDataResource(
      200,
      "SUCCESS_UPDATE_DATA",
      "Berhasil Memperbarui",
      `Data Layer '${name}' berhasil diperbarui.`,
      result
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
    logger.error(`| Layers | - Error function update : ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.destroy = async (req, res) => {
  const id = req.params.id;
  const trx = await knex.transaction();

  try {
    // 1. Ambil data layer
    const existing = await trx("layers").where("id", id).first();
    if (!existing) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Workspace dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    const { table_name, document_id } = existing;

    // 2. Jalankan helper untuk hapus tabel dan dokumen
    await handleDeleteTableWithDocument(table_name, document_id);

    // 3. Hapus layer dari DB
    await trx("layers").where("id", id).del();

    await trx.commit();

    const response = new WithoutDataResource(
      200,
      "SUCCESS_DELETE_DATA",
      "Berhasil Menghapus Data",
      `Layer dan seluruh data tabel shapefile atau geojson yang terkait berhasil dihapus.`
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
    logger.error(`| Layers | - Error function destroy : ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.getLayersbyWorkspaceId = async (req, res) => {
  const { workspace_id } = req.params;

  try {
    // 1. Ambil semua layer aktif berdasarkan workspace_id
    const layers = await knex("layers")
      .where("workspace_id", workspace_id)
      .whereNull("deleted_at");

    // Jika tidak ada layer sama sekali
    if (!layers || layers.length === 0) {
      const response = new WithoutDataResource(
        404,
        "LAYERS_NOT_FOUND",
        "Layer Tidak Ditemukan",
        `Tidak ada layer yang tersedia di workspace ID ${workspace_id}`
      );
      return res.status(404).json(response.toResponse());
    }

    // 2. Serialize setiap layer dengan layersResource
    const results = [];
    for (const layer of layers) {
      const serialized = await layersResource(layer);
      results.push(serialized);
    }

    // 3. Jika semua layer tidak memiliki shapefile (data kosong)
    if (results.every((layer) => layer.data.length === 0)) {
      const response = new WithoutDataResource(
        404,
        "SHAPEFILES_NOT_FOUND",
        "Shapefile Tidak Ditemukan",
        `Workspace ID ${workspace_id} memiliki layer, tetapi belum ada shapefile yang diunggah.`
      );
      return res.status(404).json(response.toResponse());
    }

    const response = new WithDataResource(
      200, // HTTP Status Code: Success
      "SUCCESS_GET_LAYERS",
      "Berhasil Mengambil Data Layer",
      `Berhasil mengambil semua layer untuk workspace ID ${workspace_id}`,
      results
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Layers | - Error getLayersbyWorkspaceId: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.updateShapefileData = async (req, res) => {
  const { table_name, layer_id, properties, delete_document_ids } = req.body;
  const trx = await knex.transaction();
  const allowedUpdateColumns = [
    "PARAPIHAKB",
    "PERMASALAH",
    "TINDAKLANJ",
    "HASIL",
  ];

  try {
    // 0. Validasi table_name ada di database
    const tableCheck = await knex.raw(`SELECT to_regclass(?) AS exists`, [
      table_name,
    ]);
    if (!tableCheck.rows[0]?.exists) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "TABLE_NOT_FOUND",
        "Tabel tidak ditemukan",
        `Tabel '${table_name}' tidak ditemukan di database.`
      );
      return res.status(400).json(response.toResponse());
    }

    // 0. Validasi layer_id ada
    const layer = await trx("layers")
      .where("id", layer_id)
      .whereNull("deleted_at")
      .first();
    if (!layer) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "LAYER_NOT_FOUND",
        "Layer tidak ditemukan",
        `Layer dengan ID ${layer_id} tidak ditemukan.`
      );
      return res.status(400).json(response.toResponse());
    }

    // 1. Parsing properti
    let parsedProperties = properties;
    if (typeof properties === "string") {
      parsedProperties = JSON.parse(properties);
    }

    // 2. Update data berdasarkan ID dalam properties
    const { id, ...updateFields } = parsedProperties;

    // 2.1 Validasi hanya kolom yang diizinkan
    const disallowedFields = Object.keys(updateFields).filter(
      (key) => !allowedUpdateColumns.includes(key)
    );
    if (disallowedFields.length > 0) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "UNAUTHORIZED_COLUMNS",
        "Terdapat kolom yang tidak diizinkan untuk diubah",
        `Hanya kolom berikut yang diperbolehkan untuk diubah: ${allowedUpdateColumns.join(
          ", "
        )}`
      );
      return res.status(400).json(response.toResponse());
    }

    // 2.2 Filter hanya kolom yang diizinkan untuk benar-benar diupdate
    const filteredUpdateFields = Object.fromEntries(
      Object.entries(updateFields).filter(([key]) =>
        allowedUpdateColumns.includes(key)
      )
    );
    const updated = await trx(table_name)
      .where("id", id)
      .update(filteredUpdateFields);
    if (updated === 0) {
      await trx.rollback();
      const response = new WithoutDataResource(
        404, // HTTP Status Code: Not Found
        "DATA_NOT_FOUND",
        "Data tidak ditemukan",
        `Tidak ada baris dengan ID ${id} pada tabel ${table_name}.`
      );
      return res.status(404).json(response.toResponse());
    }

    // 3. Ambil document_ids yang sudah ada
    const existing = await trx(table_name).where("id", id).first();
    let currentIds = existing?.document_ids || [];

    let deletedIds = delete_document_ids;
    if (typeof delete_document_ids === "string") {
      try {
        deletedIds = JSON.parse(delete_document_ids);
      } catch (err) {
        await trx.rollback();
        const response = new WithoutDataResource(
          400, // HTTP Status Code: Not Found
          "INVALID_DELETE_DOC_IDS",
          "Format delete_document_ids tidak valid",
          "Pastikan delete_document_ids berbentuk array JSON yang benar, contoh: [1,2,3]"
        );
        return res.status(400).json(response.toResponse());
      }
    }

    // 4. Proses penghapusan dokumen jika ada
    if (Array.isArray(deletedIds) && deletedIds.length > 0) {
      // Hapus dokumen dari tabel documents
      await trx("documents").whereIn("id", deletedIds).del();

      // Filter keluar dokumen yang dihapus dari currentIds
      currentIds = currentIds.filter((docId) => !deletedIds.includes(docId));

      // Simpan kembali ke kolom document_ids
      await trx(table_name)
        .where("id", id)
        .update({ document_ids: JSON.stringify(currentIds) });
    }

    // 5. Validasi & upload dokumen jika ada
    let uploadedDocumentIds = [];
    if (req.files && req.files.length > 0) {
      if (req.files.length + currentIds.length > 5) {
        await trx.rollback();
        return res
          .status(400)
          .json(
            new WithoutDataResource(
              400,
              "MAX_TOTAL_FILES",
              "Terlalu Banyak Dokumen",
              `Dokumen sebelumnya berjumlah ${currentIds.length}, jika ditambah ${req.files.length} akan melebihi batas maksimal 5 file.`
            ).toResponse()
          );
      }

      for (const file of req.files) {
        const allowedTypes = [
          "application/pdf",
          "application/msword", // for .doc files
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // for .docx files
        ];
        if (!allowedTypes.includes(file.mimetype)) {
          const response = new WithoutDataResource(
            400,
            "INVALID_FILE_TYPE",
            "Tipe Dokumen Salah",
            "File dokumen hanya boleh PDF, DOC, dan DOCX."
          );
          return res.status(400).json(response.toResponse());
        }
        if (file.size > 10 * 1024 * 1024) {
          const response = new WithoutDataResource(
            400,
            "FILE_TOO_LARGE",
            "Ukuran Dokumen Terlalu Besar",
            "Ukuran maksimal tiap file adalah 10MB."
          );
          return res.status(400).json(response.toResponse());
        }
      }

      const uploadedDocuments = await uploadDocuments(req.files);
      uploadedDocumentIds = uploadedDocuments.map((doc) => doc.id);
      const newIds = [...new Set([...currentIds, ...uploadedDocumentIds])];

      await trx(table_name)
        .where("id", id)
        .update({ document_ids: JSON.stringify(newIds) });
    }

    // 6. Commit transaksi
    await trx.commit();

    // 7. Ambil kembali layer terbaru
    const updatedLayer = await knex("layers").where("id", layer_id).first();
    const result = await layersResource(updatedLayer);

    const response = new WithDataResource(
      200,
      "SUCCESS_UPDATE_SHAPEFILE",
      "Data berhasil diperbarui",
      `Data shapefile dengan ID ${id} pada tabel ${table_name} berhasil diperbarui.`,
      result
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    await trx.rollback(); // Rollback jika error
    logger.error(
      `| Update Shapefile | - Error updateShapefileData: ${error.message}`
    );
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

exports.getLayerProperties = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Ambil layer berdasarkan layer_id
    const layer = await knex("layers")
      .select("id", "table_name")
      .where("id", id)
      .whereNull("deleted_at")
      .first();

    // 2. Jika layer tidak ditemukan
    if (!layer) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Layer dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 3. Ambil table_name & pecah schema bila ada
    const tableNameRaw = layer.table_name;
    let schema = "public";
    let tableName = tableNameRaw;

    if (tableNameRaw.includes(".")) {
      const [sch, tbl] = tableNameRaw.split(".", 2);
      schema = sch || "public";
      tableName = tbl;
    }

    // 4. Cek apakah tabel ada
    const existsQuery = await knex.raw(
      `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = ? AND table_name = ?
      ) AS exists;
      `,
      [schema, tableName]
    );

    const tableExists = existsQuery.rows?.[0]?.exists === true;
    if (!tableExists) {
      const response = new WithoutDataResource(
        404,
        "TABLE_NOT_FOUND",
        "Tabel Tidak Ditemukan",
        `Tabel '${tableNameRaw}' tidak ditemukan pada schema '${schema}'.`
      );
      return res.status(404).json(response.toResponse());
    }

    // 5. Ambil semua kolom selain yang dikecualikan
    const columnsQuery = await knex.raw(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
      ORDER BY ordinal_position;
      `,
      [schema, tableName]
    );

    const excluded = new Set([
      "id",
      "geom",
      "layer_id",
      "document_ids",
      "color",
    ]);
    const properties = (columnsQuery.rows || [])
      .map((r) => r.column_name)
      .filter((name) => !excluded.has(String(name).toLowerCase()));

    // 6. Susun result (tanpa resource transformer)
    const result = {
      table_name: tableNameRaw,
      properties, // array of string
    };

    const response = new WithDataResource(
      200,
      "SUCCESS_GET_DATA",
      "Berhasil Mengambil Data",
      `Berhasil mengambil daftar properti dari tabel '${tableNameRaw}'.`,
      result
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Layers | - Error function getLayerProperties: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

// Fungsi untuk menampilkan dengan geojson
async function layersResource(layer, depth = 0) {
  const MAX_DEPTH = 3;
  const workspace = layer.workspace_id
    ? await knex("workspaces").where("id", layer.workspace_id).first()
    : null;

  const parentLayer =
    layer.parent_layer_id && depth < MAX_DEPTH
      ? await knex("layers").where("id", layer.parent_layer_id).first()
      : null;

  const serializedLayer = await serializeLayer(layer);

  // Ambil semua baris dari table_name
  let data = null;
  try {
    const rows = await knex(layer.table_name).select("*");

    if (rows.length > 0) {
      const firstRow = rows[0];

      const geojsonResult = convertShapefileRowsToGeoJSON(rows);
      const features = geojsonResult.features;
      const bbox = geojsonResult.bbox;
      const center = geojsonResult.center;

      // TODO: Pindah documents kedalam features
      const documents = await resolveArrayRelations(
        firstRow.document_ids || [],
        "documents"
      );

      data = {
        id: firstRow.id,
        layer_id: serializedLayer,
        documents,
        bbox,
        bbox_center: center,
        geojson: {
          type: "FeatureCollection",
          features,
        },
        created_at: firstRow.created_at,
        updated_at: firstRow.updated_at,
        deleted_at: firstRow.deleted_at,
      };
    }
  } catch (err) {
    console.error(
      `❌ Error mengambil data dari ${layer.table_name}:`,
      err.message
    );
    data = null;
  }

  return {
    id: layer.id,
    workspace: workspace ? await workspaceResource(workspace) : null,
    parent_layer: parentLayer
      ? await layersResource(parentLayer, depth + 1)
      : null,
    name: layer.name,
    description: layer.description,
    table_name: layer.table_name,
    layer_type: layer.layer_type,
    with_explanation: layer.with_explanation,
    data,
    created_at: layer.created_at,
    updated_at: layer.updated_at,
    deleted_at: layer.deleted_at,
  };
}

// Fungsi untuk menampilkan tanpa geojson
async function layersStoreUpdateResource(layer, depth = 0) {
  const MAX_DEPTH = 3;
  const workspace = layer.workspace_id
    ? await knex("workspaces").where("id", layer.workspace_id).first()
    : null;

  const parentLayer =
    layer.parent_layer_id && depth < MAX_DEPTH
      ? await knex("layers").where("id", layer.parent_layer_id).first()
      : null;

  const serializedLayer = await serializeLayer(layer);

  // Ambil semua baris dari table_name
  let data = null;
  try {
    const rows = await knex(layer.table_name).select("*");

    if (rows.length > 0) {
      const firstRow = rows[0];

      const geojsonResult = convertShapefileRowsToGeoJSON(rows);
      // const features = geojsonResult.features;
      const bbox = geojsonResult.bbox;
      const center = geojsonResult.center;

      const documents = await resolveArrayRelations(
        firstRow.document_ids || [],
        "documents"
      );

      data = {
        id: firstRow.id,
        layer_id: serializedLayer,
        documents,
        bbox,
        bbox_center: center,
        // geojson: {
        //   type: "FeatureCollection",
        //   features,
        // },
        created_at: firstRow.created_at,
        updated_at: firstRow.updated_at,
        deleted_at: firstRow.deleted_at,
      };
    }
  } catch (err) {
    console.error(
      `❌ Error mengambil data dari ${layer.table_name}:`,
      err.message
    );
    data = null;
  }

  return {
    id: layer.id,
    workspace: workspace ? await workspaceResource(workspace) : null,
    parent_layer: parentLayer
      ? await layersResource(parentLayer, depth + 1)
      : null,
    name: layer.name,
    description: layer.description,
    table_name: layer.table_name,
    layer_type: layer.layer_type,
    with_explanation: layer.with_explanation,
    data,
    created_at: layer.created_at,
    updated_at: layer.updated_at,
    deleted_at: layer.deleted_at,
  };
}

async function handleShapefileUpload(
  shpFullPath,
  tableName,
  layerId,
  withExplanation = false
) {
  await convertShapefileToPostgres(
    shpFullPath,
    tableName,
    "public",
    layerId,
    withExplanation
  );

  // Setelah konversi selesai, hapus folder temp
  try {
    const extractPath = path.dirname(shpFullPath);
    fs.rmSync(extractPath, { recursive: true, force: true });
    logger.info(
      `| handleShapefileUpload | - Folder temp ${extractPath} berhasil dihapus.`
    );
  } catch (err) {
    logger.error(
      `| handleShapefileUpload | - Gagal menghapus folder temp: ${err.message}`
    );
  }
}

async function handleDeleteTableWithDocument(tableName, layerDocumentId) {
  try {
    // 1. Cek apakah kolom "document_ids" ada di dalam table
    const columnCheck = await knex("information_schema.columns")
      .select("column_name")
      .where({
        table_name: tableName,
        column_name: "document_ids",
      });

    let collectedDocIds = [];

    // 2. Jika kolomnya ada, ambil dan proses datanya
    if (columnCheck.length > 0) {
      const records = await knex.select("document_ids").from(tableName);

      collectedDocIds = records
        .flatMap((row) => row.document_ids || [])
        .filter((v, i, arr) => arr.indexOf(v) === i); // hapus duplikat

      if (collectedDocIds.length > 0) {
        await deleteDocuments(collectedDocIds);
      }
    }

    // 3. Hapus dokumen utama dari layer jika ada dan belum termasuk di array
    if (layerDocumentId && !collectedDocIds.includes(layerDocumentId)) {
      await deleteDocuments([layerDocumentId]);
    }

    // 4. Drop table fisik dari PostgreSQL
    await knex.raw(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
  } catch (error) {
    throw new Error(
      `Gagal menghapus dokumen dan tabel '${tableName}': ${error.message}`
    );
  }
}
