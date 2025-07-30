const path = require("path");
const wkx = require("wkx");
const { validationResult } = require("express-validator");
const knex = require("../config/database");
const logger = require("../utils/logger");
const { uploadDocuments } = require("../helpers/documentHelper");
const WithDataResource = require("../resources/WithDataResource");
const WithoutDataResource = require("../resources/WithoutDataResource");
const fs = require("fs");
const { extractZipShapefile } = require("../helpers/extractZipShapefile");
const {
  convertShapefileToPostgres,
} = require("../helpers/convertShapefileToPostgres");
const { publishPostGISLayer } = require("../helpers/geoServerHelper");

// new khusus shp
const {
  convertShapefileRowsToGeoJSON,
} = require("../helpers/shapefileToGeoJSONHelper");

exports.storeShapeFile = async (req, res) => {
  const trx = await knex.transaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const message = errors
        .array()
        .map((err) => err.msg)
        .join(" ");
      const response = new WithoutDataResource(
        400, // HTTP Status Code: Bad Request
        "VALIDATION_FAILED",
        "Format Data Tidak Sesuai Ketentuan",
        message
      );
      return res.status(400).json(response.toResponse());
    }

    const { workspace_id } = req.body;

    if (!req.files || req.files.length === 0) {
      const response = new WithoutDataResource(
        400, // HTTP Status Code: Bad Request
        "FILES_NOT_FOUND",
        "Dokumen Tidak Ditemukan",
        "Dokumen shapefile wajib diunggah."
      );
      return res.status(400).json(response.toResponse());
    }

    // Validasi file upload
    if (!req.files || req.files.length === 0) {
      const response = new WithoutDataResource(
        400, // HTTP Status Code: Bad Request
        "FILES_NOT_FOUND",
        "Dokumen Tidak Ditemukan",
        "Dokumen shapefile wajib diunggah."
      );
      return res.status(400).json(response.toResponse());
    }
    if (req.files.length > 1) {
      const response = new WithoutDataResource(
        400, // HTTP Status Code: Bad Request
        "MAX_FILES",
        "Terlalu Banyak Dokumen",
        "Maksimal upload adalah 1 file."
      );
      return res.status(400).json(response.toResponse());
    }

    for (const file of req.files) {
      if (file.size > 20 * 1024 * 1024) {
        const response = new WithoutDataResource(
          400, // HTTP Status Code: Bad Request
          "FILE_TOO_LARGE",
          "Ukuran Dokumen Terlalu Besar",
          "Ukuran maksimal tiap file adalah 20MB."
        );
        return res.status(400).json(response.toResponse());
      }
    }

    // Upload dokumen
    const uploadedDocuments = await uploadDocuments(req.files);
    const documentId = uploadedDocuments[0]?.id;
    const relativePath = uploadedDocuments[0]?.file_path;
    const filePath = path.join(__dirname, "..", "public", relativePath);

    // Validasi workspace_id
    const workspace = await trx("workspaces")
      .select("id")
      .where("id", workspace_id)
      .first();
    if (!workspace) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400, // HTTP Status Code: Bad Request
        "INVALID_WORKSPACE_ID",
        "ID Workspace Tidak Valid",
        "workspace_id tidak ditemukan di database."
      );
      return res.status(400).json(response.toResponse());
    }

    // Ambil satu layer dari workspace_layers (default: pertama yang ditemukan)
    const workspaceLayer = await trx("workspace_layers")
      .select("id", "layer_name", "description")
      .where("workspace_id", workspace_id)
      .orderBy("id", "asc")
      .first();
    if (!workspaceLayer) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400, // HTTP Status Code: Bad Request
        "NO_WORKSPACE_LAYER_FOUND",
        "Layer Tidak Tersedia",
        "Tidak ditemukan layer untuk workspace yang diberikan."
      );
      return res.status(400).json(response.toResponse());
    }

    const tableName = `shp_workspace_${workspace_id}_layer_${workspaceLayer.id}`;

    // Simpan ke tabel workspace_layer_shapefiles
    await trx("workspace_layer_shapefiles").insert({
      workspace_layer_id: workspaceLayer.id,
      document_id: documentId,
      shp_table: tableName,
    });

    await trx.commit();

    // Ekstrak & konversi shapefile
    await handleShapefileUpload(filePath, tableName);

    // Handle agar response sama seperti getAllShapeFilesByWorkspaceId
    const results = [];

    const shpData = await knex(tableName).select("*");
    const geojson = convertShapefileRowsToGeoJSON(shpData);

    results.push({
      workspace_id: Number(workspace_id),
      layer_id: workspaceLayer.id,
      layer_name: workspaceLayer.layer_name,
      description: workspaceLayer.description,
      table_name: tableName,
      geojson: geojson,
    });

    // Jika tidak ada satupun tabel shapefile ditemukan
    if (results.length === 0) {
      await trx.rollback();
      const response = new WithoutDataResource(
        404,
        "SHAPEFILES_NOT_FOUND",
        "Shapefile Tidak Ditemukan",
        `Workspace ID ${workspace_id} memiliki layer, tetapi belum ada shapefile yang diunggah.`
      );
      return res.status(404).json(response.toResponse());
    }

    const response = new WithDataResource(
      201, // HTTP Status Code: Created
      "SUCCESS_CREATE_DATA",
      "Berhasil Menyimpan Data",
      "Dokumen shapefile berhasil diunggah, diekstrak, dan dikonversi ke database.",
      results
    );
    return res.status(201).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
    logger.error(`| Workspace | - Error function store: ${error.message}`);
    const response = new WithoutDataResource(
      500, // HTTP Status Code: Internal Server Error
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.getAllUniquePenggunaan = async (req, res) => {
  try {
    const workspaces = await knex("workspaces")
      .select("id", "title")
      .whereNull("deleted_at");
    if (!workspaces || workspaces.length === 0) {
      const response = new WithoutDataResource(
        404, // HTTP Status Code: OK
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        "Tidak ada workspace yang tersedia"
      );
      return res.status(404).json(response.toResponse());
    }

    const semuaFitur = [];

    for (const workspace of workspaces) {
      const layers = await knex("workspace_layers")
        .select("id", "workspace_id", "layer_name", "description")
        .where("workspace_id", workspace.id)
        .whereNull("deleted_at");

      // Loop setiap layer untuk mendapatkan shapefile dan geojson
      for (const layer of layers) {
        const tableName = `shp_workspace_${workspace.id}_layer_${layer.id}`;

        const tableExists = await knex.schema.hasTable(tableName);
        if (!tableExists) continue;

        const rows = await knex(tableName).select("*");
        const geojson = convertShapefileRowsToGeoJSON(rows);

        // Push fitur ke semuaFitur
        semuaFitur.push(...geojson.features);
      }
    }

    const uniquePenggunaan = await getUniquePenggunaanFromGeoJSON(semuaFitur);

    const response = new WithDataResource(
      200,
      "SUCCESS_GET_DATA",
      "Berhasil Mendapatkan Data",
      "Berhasil mendapatkan semua data penggunaan",
      uniquePenggunaan
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(
      `| Workspace | - Error getAllUniquePenggunaan: ${error.message}`
    );
    const response = new WithoutDataResource(
      500, // HTTP Status Code: Internal Server Error
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    return res.status(500).json(response.toResponse());
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
      const geojson = convertShapefileRowsToGeoJSON(shpData);

      results.push({
        workspace_id: Number(workspace_id),
        layer_id: layer.id,
        layer_name: layer.layer_name,
        description: layer.description,
        table_name: tableName,
        geojson: geojson,
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

    const response = new WithDataResource(
      200, // HTTP Status Code: Success
      "SUCCESS_GET_ALL_SHAPEFILES",
      "Berhasil Mengambil Semua Shapefiles",
      `Berhasil mengambil semua shapefile di workspace ID ${workspace_id}`,
      results
    );
    return res.status(201).json(response.toResponse());
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

exports.getSingleShapefileFeature = async (req, res) => {
  const { workspace_id, workspace_layer_id, feature_id } = req.params;

  const tableName = `shp_workspace_${workspace_id}_layer_${workspace_layer_id}`;

  try {
    // 1. Cek apakah tabel ada
    const tableExists = await knex.schema.hasTable(tableName);
    if (!tableExists) {
      const response = new WithoutDataResource(
        404, // HTTP Status Code: Not Found
        "TABLE_NOT_FOUND",
        "Tabel tidak ditemukan",
        `Tabel ${tableName} tidak tersedia.`
      );
      return res.status(404).json(response.toResponse());
    }

    // 2. Ambil data berdasarkan ID
    const row = await knex(tableName).where("id", feature_id).first();
    if (!row) {
      const response = new WithoutDataResource(
        404, // HTTP Status Code: Not Found
        "DATA_NOT_FOUND",
        "Data tidak ditemukan",
        `Data dengan ID ${feature_id} tidak ditemukan dalam tabel ${tableName}.`
      );
      return res.status(404).json(response.toResponse());
    }

    // 3. Ubah WKB hex ke geometry GeoJSON
    const geomHex = row.geom;
    const geometry = wkx.Geometry.parse(
      Buffer.from(geomHex, "hex")
    ).toGeoJSON();

    // 4. Hapus geom dari properties
    const { geom, ...properties } = row;

    // 5. Return GeoJSON Feature
    const feature = {
      type: "Feature",
      geometry,
      properties,
    };

    const response = new WithDataResource(
      200,
      "SUCCESS_GET_DATA",
      "Berhasil Mengambil Data",
      `Berhasil mengambil data dengan ID ${feature_id} dari tabel ${tableName}`,
      feature
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| getSingleShapefileFeature | Error: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

exports.updateShapefileData = async (req, res) => {
  const { table_name, layer_id, properties } = req.body;

  let parsedProperties = properties;
  if (typeof properties === "string") {
    parsedProperties = JSON.parse(properties);
  }

  if (!table_name || !layer_id || !parsedProperties) {
    const response = new WithoutDataResource(
      400, // HTTP Status Code: Bad Request
      "INVALID_PAYLOAD",
      "Payload tidak valid",
      "Field 'layer_id', 'table_name', dan 'properties' tidak boleh kosong."
    );
    return res.status(400).json(response.toResponse());
  }

  const trx = await knex.transaction();

  try {
    const createdBy = req.user?.id || 1;

    const tableExists = await trx.schema.hasTable(table_name);
    if (!tableExists) {
      await trx.rollback();
      const response = new WithoutDataResource(
        404, // HTTP Status Code: Not Found
        "TABLE_NOT_FOUND",
        "Tabel shapefile tidak ditemukan",
        `Tabel ${table_name} tidak tersedia dalam database.`
      );
      return res.status(404).json(response.toResponse());
    }

    const { id, ...updateFields } = parsedProperties;

    const updated = await trx(table_name).where("id", id).update(updateFields);

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

    const workspaceLayerExists = await trx("workspace_layers")
      .where("id", layer_id)
      .first();
    if (!workspaceLayerExists) {
      await trx.rollback();
      const response = new WithoutDataResource(
        404, // HTTP Status Code: Not Found
        "WORKSPACE_LAYER_NOT_FOUND",
        "Workspace Layer tidak ditemukan",
        `Layer dengan ID ${layer_id} tidak ditemukan dalam workspace_layers.`
      );
      return res.status(404).json(response.toResponse());
    }

    const workspaceLayerShapefileExists = await trx(
      "workspace_layer_shapefiles"
    )
      .where("workspace_layer_id", layer_id)
      .where("shp_table", table_name)
      .first();

    const workspaceLayerGeojsonExists = await trx("workspace_layer_geojsons")
      .where("workspace_layer_id", layer_id)
      .where("geojson_table", table_name)
      .first();

    // If neither workspace_layer_shapefiles nor workspace_layer_geojsons exists
    if (!workspaceLayerShapefileExists && !workspaceLayerGeojsonExists) {
      await trx.rollback();
      const response = new WithoutDataResource(
        404, // HTTP Status Code: Not Found
        "LAYER_NOT_FOUND",
        "Layer tidak ditemukan",
        `Layer dengan ID ${layer_id} tidak ditemukan.`
      );
      return res.status(404).json(response.toResponse());
    }

    if (req.files.length > 5) {
      const response = new WithoutDataResource(
        400,
        "MAX_FILES",
        "Terlalu Banyak Dokumen",
        "Maksimal upload adalah 5 file."
      );
      return res.status(400).json(response.toResponse());
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

    const uploadedDocuments = await uploadDocuments(req.files, createdBy);
    const documentIds = uploadedDocuments.map((doc) => doc.id);
    const documentIdsJson = JSON.stringify(documentIds);

    if (workspaceLayerShapefileExists) {
      await trx("workspace_layer_shapefiles")
        .where("workspace_layer_id", layer_id)
        .where("shp_table", table_name)
        .update("another_document", documentIdsJson);
    } else if (workspaceLayerGeojsonExists) {
      await trx("workspace_layer_geojsons")
        .where("workspace_layer_id", layer_id)
        .where("geojson_table", table_name)
        .update("another_document", documentIdsJson);
    }

    await trx.commit();

    const response = new WithoutDataResource(
      200, // HTTP Status Code: OK
      "SUCCESS_UPDATE_SHAPEFILE",
      "Data berhasil diperbarui",
      `Data shapefile dengan ID ${id} pada tabel ${table_name} berhasil diperbarui.`
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

async function handleShapefileUpload(zipPath, tableName) {
  const { extractPath, fileList } = await extractZipShapefile(zipPath);
  const shpFile = fileList.find((file) => file.endsWith(".shp"));

  if (!shpFile) throw new Error("File .shp tidak ditemukan di dalam ZIP.");

  const shpFullPath = shpFile;

  await convertShapefileToPostgres(shpFullPath, tableName);

  // Setelah konversi selesai, hapus folder temp
  try {
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

async function getUniquePenggunaanFromGeoJSON(features) {
  const penggunaanSet = new Set();

  for (const feature of features) {
    const penggunaan = feature?.properties?.penggunaan;
    if (penggunaan && typeof penggunaan === "string") {
      penggunaanSet.add(penggunaan.trim());
    }
  }

  return Array.from(penggunaanSet);
}
