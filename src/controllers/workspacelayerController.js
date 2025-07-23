const path = require("path");
const { validationResult } = require("express-validator");
const knex = require("../config/database");
const logger = require("../utils/logger");
const { uploadDocuments } = require("../helpers/documentHelper");
const WithoutDataResource = require("../resources/WithoutDataResource");
const { extractZipShapefile } = require("../helpers/extractZipShapefile");
const {
  convertShapefileToPostgres,
} = require("../helpers/convertShapefileToPostgres");
const { publishPostGISLayer } = require("../helpers/geoServerHelper");

exports.storeShapeFile = async (req, res) => {
  try {
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

    const { workspace_layer_id } = req.body;

    if (!req.files || req.files.length === 0) {
      const response = new WithoutDataResource(
        400,
        "FILES_NOT_FOUND",
        "Dokumen Tidak Ditemukan",
        "Dokumen shapefile wajib diunggah."
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

    // for (const file of req.files) {
    //   const allowedTypes = ["application/zip"];
    //   if (!allowedTypes.includes(file.mimetype)) {
    //     const response = new WithoutDataResource(
    //       400,
    //       "INVALID_FILE_TYPE",
    //       "Tipe Dokumen Salah",
    //       "File dokumen hanya boleh ZIP (shapefile)."
    //     );
    //     return res.status(400).json(response.toResponse());
    //   }
    //   if (file.size > 10 * 1024 * 1024) {
    //     const response = new WithoutDataResource(
    //       400,
    //       "FILE_TOO_LARGE",
    //       "Ukuran Dokumen Terlalu Besar",
    //       "Ukuran maksimal tiap file adalah 10MB."
    //     );
    //     return res.status(400).json(response.toResponse());
    //   }
    // }

    // 1. Upload ZIP dokumen ke storage
    const uploadedDocuments = await uploadDocuments(req.files);
    const documentId = uploadedDocuments[0]?.id;
    const relativePath = uploadedDocuments[0]?.file_path;
    const filePath = path.join(__dirname, "..", "public", relativePath);

    // 2. Simpan relasi ke tabel
    await knex("workspace_layer_shapefiles").insert({
      workspace_layer_id,
      document_id: documentId,
    });

    const workspace = await knex("workspace_layers")
      .select("workspace_id")
      .where("id", workspace_layer_id)
      .first();

    if (!workspace) {
      throw new Error("workspace_layer_id tidak ditemukan di database.");
    }

    const workspace_id = workspace.workspace_id;
    const tableName = `shp_workspace_${workspace_id}_layer_${workspace_layer_id}`;

    // 3. Ekstrak, konversi shapefile ke PostgreSQL lalu publish ke GeoServer
    await handleShapefileUpload(filePath, tableName);
    // await publishPostGISLayer(tableName);

    const response = new WithoutDataResource(
      201,
      "SUCCESS_CREATE_DATA",
      "Berhasil Menyimpan Data",
      `Dokumen shapefile berhasil diunggah, diekstrak, dan dikonversi ke database.`
    );
    return res.status(201).json(response.toResponse());
  } catch (error) {
    logger.error(
      `| Workspace Layer | - Error function store: ${error.message}`
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

exports.getAllShapeFilesByWorkspaceId = async (req, res) => {
  const { workspace_id } = req.params;

  try {
    const layers = await knex("workspace_layers")
      .select("id", "layer_name", "description")
      .where("workspace_id", workspace_id)
      .whereNull("deleted_at");

    // Jika tidak ada layer sama sekali
    if (!layers || layers.length === 0) {
      const response = new WithoutDataResource(
        404,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Tidak ada layer yang tersedia di workspace ID ${workspace_id}`
      );
      return res.status(404).json(response.toResponse());
    }

    const results = [];

    for (const layer of layers) {
      const tableName = `shp_workspace_${workspace_id}_layer_${layer.id}`;

      // Cek apakah tabel shapefile ada
      const tableExists = await knex.schema.hasTable(tableName);

      if (!tableExists) {
        logger.warn(`Tabel ${tableName} tidak ditemukan, dilewati.`);
        continue;
      }

      const shpData = await knex(tableName).select("*");

      results.push({
        layer_id: layer.id,
        layer_name: layer.layer_name,
        description: layer.description,
        table_name: tableName,
        data: shpData,
      });
    }

    // Jika tidak ada satupun tabel shapefile ditemukan
    if (results.length === 0) {
      const response = new WithoutDataResource(
        404,
        "SHAPEFILES_NOT_FOUND",
        "Shapefile Tidak Ditemukan",
        `Workspace ID ${workspace_id} memiliki layer, tetapi belum ada shapefile yang diunggah.`
      );
      return res.status(404).json(response.toResponse());
    }

    return res.json({
      status: 200,
      code: "SUCCESS_GET_ALL_SHAPEFILES",
      message: `Berhasil mengambil semua shapefile di workspace ID ${workspace_id}`,
      data: results,
    });
  } catch (error) {
    logger.error(
      `| Workspace Layer | - Error getAllShapeFilesByWorkspaceId: ${error.message}`
    );
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan saat mengambil data shapefile"
    );
    return res.status(500).json(response.toResponse());
  }
};

async function handleShapefileUpload(zipPath, tableName) {
  const { fileList } = await extractZipShapefile(zipPath);
  const shpFile = fileList.find((file) => file.endsWith(".shp"));

  if (!shpFile) throw new Error("File .shp tidak ditemukan di dalam ZIP.");

  const shpFullPath = shpFile;

  await convertShapefileToPostgres(shpFullPath, tableName);
}
