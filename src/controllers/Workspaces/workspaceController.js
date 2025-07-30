const { validationResult } = require("express-validator");
const knex = require("../../config/database");
const logger = require("../../utils/logger");
const {
  applySearch,
  applyPagination,
  formatPaginationResult,
} = require("../../helpers/queryHelper");
const {
  uploadDocuments,
  deleteDocuments,
} = require("../../helpers/documentHelper");
const WithDataResource = require("../../resources/WithDataResource");
const WithoutDataResource = require("../../resources/WithoutDataResource");
const workspaceResource = require("../../resources/Workspaces/workspaceResource");

exports.index = async (req, res) => {
  try {
    const { search } = req.query;

    // 1. Bangun query dasar
    let query = knex("workspaces as w")
      .select(
        "w.id",
        "w.category_id",
        "w.title",
        "w.description",
        "w.document_id",
        "w.deleted_at",
        "w.created_at",
        "w.updated_at"
      )
      .leftJoin("workspace_categories as c", "w.category_id", "c.id")
      .whereNull("w.deleted_at")
      .orderBy("w.created_at", "desc");

    // 2. Tambahkan search jika ada
    applySearch(query, search, ["w.title", "c.label"]);

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
      result.data.map((workspace) => workspaceResource(workspace))
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
      "Terjadi kesalahan pada sistem, silakan coba lagi nanti atau hubungi admin."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.store = async (req, res) => {
  const trx = await knex.transaction();
  const { workspace_category_id, title, description } = req.body;

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
    // if (!req.files || req.files.length === 0) {
    //   const response = new WithoutDataResource(
    //     400,
    //     "FILES_NOT_FOUND",
    //     "Dokumen Tidak Ditemukan",
    //     "Dokumen thumbnail wajib diunggah."
    //   );
    //   return res.status(400).json(response.toResponse());
    // }
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

    // 3. Cek duplikat title
    const exists = await trx("workspaces")
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

    // 4. Upload dokumen (document_id)
    const uploadedDocuments = await uploadDocuments(req.files);
    const document_id =
      uploadedDocuments.length > 0 ? uploadedDocuments[0].id : null;

    // 5. Simpan workspace
    const [newWorkspace] = await trx("workspaces")
      .insert({
        category_id: workspace_category_id,
        document_id,
        title,
        description,
      })
      .returning("*");

    await trx.commit();

    const savedWorkspace = await knex("workspaces")
      .where("id", newWorkspace.id)
      .first();
    const result = await workspaceResource(savedWorkspace);

    const response = new WithDataResource(
      201,
      "SUCCESS_CREATE_DATA",
      "Berhasil Menyimpan Data",
      `Data workspace '${title}' berhasil ditambahkan.`,
      result
    );
    return res.status(201).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
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
  const { id } = req.params;

  try {
    // 1. Ambil data workspace + relasi ke documents & workspace_categories
    const workspace = await knex("workspaces")
      .select("*")
      .where("id", id)
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

    // 3. Format resource
    const data = await workspaceResource(workspace);
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
  const trx = await knex.transaction();
  const { title, description, workspace_category_id, delete_document_ids } = req.body;
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
    const existing = await trx("workspaces").where("id", id).first();
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
    const duplicate = await trx("workspaces")
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
    const oldDocId = existing.document_id;
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
      const uploads = await uploadDocuments(req.files);
      newDocId = uploads[0]?.id;
    }

    // 7. Finalisasi dokumen thumbnail
    const document_id = newDocId || finalDocId;

    // 8. Update ke database
    await trx("workspaces").where("id", id).update({
      title,
      description,
      category_id: workspace_category_id,
      document_id,
      updated_at: trx.fn.now(),
    });

    // 9. Commit
    await trx.commit();

    const savedWorkspace = await knex("workspaces")
      .where("id", id)
      .first();
    const result = await workspaceResource(savedWorkspace);

    const response = new WithDataResource(
      200,
      "SUCCESS_UPDATE_DATA",
      "Berhasil Memperbarui",
      `Data workspace '${title}' berhasil diperbarui.`,
      result
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
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
  const id = req.params.id;
  const trx = await knex.transaction();

  try {
    // 1. Cari data workspace
    const workspace = await trx("workspaces").where("id", id).first();
    if (!workspace) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Workspace dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 2. Ambil semua layers milik workspace
    const layers = await trx("layers")
      .where("workspace_id", id)
      .whereNull("deleted_at");

    const tableNames = layers.map((l) => l.table_name);
    const layerDocumentIds = layers.map((l) => l.document_id).filter(Boolean);

    // 3. Ambil semua document_ids dari semua tabel dinamis
    let embeddedDocumentIds = [];
    for (const tableName of tableNames) {
      const rows = await trx(tableName).select("document_ids"); // kolom berupa jsonb array
      for (const row of rows) {
        const ids = Array.isArray(row.document_ids)
          ? row.document_ids
          : JSON.parse(row.document_ids || "[]");
        embeddedDocumentIds.push(...ids);
      }
    }

    // 4. Hapus semua dokumen
    const toDelete = [
      ...new Set([
        ...embeddedDocumentIds,
        ...layerDocumentIds,
        workspace.document_id,
      ]),
    ].filter(Boolean);

    if (toDelete.length > 0) {
      await deleteDocuments(toDelete);
    }

    // 5. Delete isi tabel dinamis
    for (const tableName of tableNames) {
      await trx(tableName).del(); // atau truncate jika tidak ada FK
    }

    // 6. Delete layers
    await trx("layers").where("workspace_id", id).del();

    // 7. Delete workspace
    await trx("workspaces").where("id", id).del();

    await trx.commit();

    const response = new WithoutDataResource(
      200,
      "SUCCESS_DELETE_DATA",
      "Berhasil Menghapus Data",
      `Workspace dan seluruh data yang terkait berhasil dihapus.`
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
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
