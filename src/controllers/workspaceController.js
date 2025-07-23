const { validationResult } = require("express-validator");
const knex = require("../config/database");
const logger = require("../utils/logger");
const {
  applySearch,
  applyPagination,
  formatPaginationResult,
} = require("../helpers/queryHelper");
const {
  uploadDocuments,
  deleteDocuments,
} = require("../helpers/documentHelper");
const WithDataResource = require("../resources/WithDataResource");
const WithoutDataResource = require("../resources/WithoutDataResource");
const WorkspaceResource = require("../resources/WorkspaceResource");

exports.index = async (req, res) => {
  try {
    const { search } = req.query;

    // 1. Bangun query dasar
    let query = knex("workspaces as w")
      .select(
        "w.id",
        "w.title",
        "w.description",
        "w.thumbnail",
        "w.deleted_at",
        "w.created_at",
        "w.updated_at"
      )
      .whereNull("w.deleted_at")
      .orderBy("w.created_at", "desc");

    // 2. Tambahkan search jika ada
    applySearch(query, search, ["w.title"]);

    // 3. Tambahkan pagination
    const paginationInfo = applyPagination(query, req.query);

    // 4. Jalankan query & hitung total
    const result = await formatPaginationResult(query, paginationInfo, knex);

    // 5. Handle jika data kosong
    if (result.data.length === 0) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        "Tidak ada data yang sesuai dengan filter atau pencarian."
      );
      return res.status(200).json(response.toResponse());
    }

    // 6. Map data melalui WorkspaceResource
    const serializedData = await Promise.all(
      result.data.map((workspace) => WorkspaceResource(workspace))
    );

    // 7. Kirim respons sukses
    const response = new WithDataResource(
      200,
      "SUCCESS_GET_DATA",
      "Berhasil Mengambil Data",
      "Data workspaces berhasil diambil.",
      {
        data: serializedData,
        pagination: result.pagination,
      }
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Workspace | - Error function index : ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.store = async (req, res) => {
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

    // 2. Validasi manual untuk files (req.files)
    if (!req.files || req.files.length === 0) {
      const response = new WithoutDataResource(
        400,
        "FILES_NOT_FOUND",
        "Dokumen Tidak Ditemukan",
        "Dokumen thumbnail wajib diunggah."
      );
      return res.status(400).json(response.toResponse());
    }
    if (req.files.length > 1) {
      const response = new WithoutDataResource(
        400,
        "MAX_FILES",
        "Terlalu Banyak Dokumen",
        "Maksimal upload adalah 1 file."
      );
      return res.status(400).json(response.toResponse());
    }

    for (const file of req.files) {
      const allowedTypes = ["image/jpeg", "image/png", "image/jpg"];
      if (!allowedTypes.includes(file.mimetype)) {
        const response = new WithoutDataResource(
          400,
          "INVALID_FILE_TYPE",
          "Tipe Dokumen Salah",
          "File dokumen hanya boleh JPG, JPEG, atau PNG."
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

    const { title, description } = req.body;
    const createdBy = req.user?.id || 1; // default user ID

    // 3. Cek duplikat title
    const exists = await knex("workspaces")
      .where("title", title)
      .whereNull("deleted_at")
      .first();

    if (exists) {
      const response = new WithoutDataResource(
        400,
        "DUPLICATE_TITLE",
        "Duplikat Data",
        `Judul workspace '${title}' sudah digunakan. Silakan gunakan judul lain.`
      );
      return res.status(400).json(response.toResponse());
    }

    // 4. Upload dokumen (thumbnail)
    const uploadedDocuments = await uploadDocuments(req.files, createdBy);
    const thumbnailId =
      uploadedDocuments.length > 0 ? uploadedDocuments[0].id : null;

    // 5. Simpan workspace
    const [newWorkspace] = await knex("workspaces")
      .insert({
        title,
        description,
        thumbnail: thumbnailId,
      })
      .returning("*");

    // 6. Insert default layer
    const [newLayer] = await knex("workspace_layers")
      .insert({
        workspace_id: newWorkspace.id,
        layer_name: "Default Layer",
        description: "Layer bawaan saat workspace dibuat.",
      })
      .returning("*");

    const response = new WithDataResource(
      201,
      "SUCCESS_CREATE_DATA",
      "Berhasil Menyimpan Data",
      `Data workspace '${title}' berhasil ditambahkan beserta layer bawaannya.`,
      {
        workspace_id: newWorkspace.id,
        workspace_layer_id: newLayer.id,
      }
    );
    return res.status(201).json(response.toResponse());
  } catch (error) {
    logger.error(`| Workspace | - Error function store: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

exports.show = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Cari data workspace (termasuk yang soft-deleted)
    const workspace = await knex("workspaces")
      .select("workspaces.*", "documents.file_url as thumbnail_url")
      .leftJoin("documents", "workspaces.thumbnail", "documents.id")
      .where("workspaces.id", id)
      .first();

    // 2. Jika tidak ditemukan
    if (!workspace) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Data workspace dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 3. Kembalikan response sukses dengan resource
    const data = await WorkspaceResource(workspace);
    const response = new WithDataResource(
      200,
      "SUCCESS_GET_DATA",
      "Berhasil Mengambil Data",
      `Detail data workspace '${workspace.title}' berhasil didapatkan.`,
      data
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Workspace | - Error function show: ${error.message}`);
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

    const { title, description, delete_document_ids } = req.body;
    const id = req.params.id;
    const updatedBy = req.user?.id || 1;

    // 2. Cek apakah data ada
    const existing = await knex("workspaces").where("id", id).first();
    if (!existing) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Data workspace dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 3. Cek duplikat title (selain ID sekarang)
    const duplicate = await knex("workspaces")
      .where("title", title)
      .whereNull("deleted_at")
      .whereNot("id", id)
      .first();
    if (duplicate) {
      const response = new WithoutDataResource(
        200,
        "DUPLICATE_TITLE",
        "Duplikat Data",
        `Judul '${title}' sudah digunakan pada workspace lain.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 4. Ambil dokumen sebelumnya
    const oldDocId = existing.thumbnail;
    const deletedIds = delete_document_ids || [];

    // 5. Jika ingin hapus dokumen lama
    let finalDocId = oldDocId;
    if (deletedIds.includes(String(oldDocId))) {
      await deleteDocuments([oldDocId]);
      finalDocId = null;
    }

    // 6. Upload dokumen baru
    let newDocId = null;
    if (req.files && req.files.length > 0) {
      const uploads = await uploadDocuments(req.files, updatedBy);
      newDocId = uploads[0]?.id;
    }

    // 7. Finalisasi dokumen thumbnail
    const thumbnailId = newDocId || finalDocId;

    // 8. Update ke database
    await knex("workspaces").where("id", id).update({
      title,
      description,
      thumbnail: thumbnailId,
      updated_at: knex.fn.now(),
    });

    const response = new WithoutDataResource(
      200,
      "SUCCESS_UPDATE_DATA",
      "Berhasil Memperbarui",
      `Data workspace '${title}' berhasil diperbarui.`
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Workspace | - Error function update : ${error.message}`);
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
  try {
    const id = req.params.id;

    // Cek apakah data ada
    const existing = await knex("workspaces")
      .where("id", id)
      .whereNull("deleted_at")
      .first();
    if (!existing) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Workspace dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // Soft delete
    await knex("workspaces").where("id", id).update({
      deleted_at: knex.fn.now(),
    });

    const response = new WithoutDataResource(
      200,
      "SUCCESS_DELETE_DATA",
      "Berhasil Menghapus Data",
      `Data workspace '${existing.title}' berhasil dihapus.`
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Workspace | - Error function destroy : ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.restore = async (req, res) => {
  try {
    const id = req.params.id;

    // 1. Cari data yang sudah dihapus (soft deleted)
    const deletedData = await knex("workspaces")
      .where("id", id)
      .whereNotNull("deleted_at")
      .first();
    if (!deletedData) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Workspace dengan ID '${id}' tidak ditemukan atau belum dihapus.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 2. Cek duplikat nama yang aktif
    const isDuplicate = await knex("workspaces")
      .where("title", deletedData.title)
      .whereNull("deleted_at")
      .first();
    if (isDuplicate) {
      const response = new WithoutDataResource(
        400,
        "DUPLICATE_TITLE",
        "Duplikat Data",
        `Judul workspace '${deletedData.title}' sudah digunakan oleh entri aktif lain. Silakan ubah judul terlebih dahulu sebelum merestore.`
      );
      return res.status(400).json(response.toResponse());
    }

    // 3. Restore = set deleted_at ke NULL
    await knex("workspaces").where("id", id).update({
      deleted_at: null,
    });

    const response = new WithoutDataResource(
      200,
      "SUCCESS_RESTORE_DATA",
      "Berhasil Mengembalikan Data",
      `Data workspace '${deletedData.title}' berhasil dikembalikan.`
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Workspace | - Error function restore : ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
    );
    return res.status(500).json(response.toResponse());
  }
};
