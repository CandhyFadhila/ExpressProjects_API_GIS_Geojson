const axios = require("axios");
const logger = require("../utils/logger");
const xmlbuilder = require("xmlbuilder");
const { baseURL, auth, workspace, datastore } = require("../config/geoserver");

// Cek dan buat workspace jika belum ada
async function ensureWorkspaceExists() {
  const workspaceUrl = `${baseURL}/workspaces/${workspace}`;
  const namespaceUrl = `${baseURL}/namespaces`;

  try {
    await axios.get(workspaceUrl, { auth });
    logger.info(`| GeoServer | - Workspace '${workspace}' sudah ada.`);
  } catch (err) {
    if (err.response?.status === 404) {
      logger.info(
        `| GeoServer | - Workspace '${workspace}' belum ada. Membuat...`
      );
      try {
        // Step 1: Buat Workspace
        const workspaceXML = xmlbuilder
          .create("workspace")
          .ele("name", workspace)
          .end({ pretty: true });

        await axios.post(`${baseURL}/workspaces`, workspaceXML, {
          auth,
          headers: { "Content-Type": "text/xml" },
        });

        logger.info(
          `| GeoServer | - Workspace '${workspace}' berhasil dibuat.`
        );

        // Step 2: Buat Namespace
        const namespaceJSON = {
          namespace: {
            prefix: workspace,
            uri: `http://mapgis.cloud/ns/${workspace}`,
          },
        };

        await axios.post(namespaceUrl, namespaceJSON, {
          auth,
          headers: { "Content-Type": "application/json" },
        });

        logger.info(
          `| GeoServer | - Namespace untuk '${workspace}' berhasil dibuat.`
        );
      } catch (createErr) {
        const msg = createErr.response?.data || createErr.message;
        logger.error(
          `| GeoServer | - Gagal membuat workspace/namespace: ${msg}`
        );
        throw new Error("Gagal membuat workspace/namespace di GeoServer");
      }
    } else {
      throw new Error("Gagal memeriksa workspace di GeoServer");
    }
  }
}

// Cek dan buat datastore jika belum ada
async function ensureDatastoreExists() {
  const url = `${baseURL}/workspaces/${workspace}/datastores/${datastore}.json`;

  try {
    await axios.get(url, { auth });
    logger.info(`| GeoServer | - Datastore '${datastore}' sudah ada.`);
  } catch (err) {
    if (err.response?.status === 404) {
      logger.info(
        `| GeoServer | - Datastore '${datastore}' belum ada. Membuat...`
      );
      await createPostGISDatastore();
    } else {
      throw new Error("Gagal memeriksa keberadaan datastore di GeoServer");
    }
  }
}

// Buat datastore PostGIS
async function createPostGISDatastore() {
  const url = `${baseURL}/workspaces/${workspace}/datastores`;

  const datastoreXML = xmlbuilder
    .create("dataStore")
    .ele("name", datastore)
    .up()
    .ele("connectionParameters")
    .ele("entry", { key: "host" }, "localhost") // Ganti jika database di host lain
    .up()
    .ele("entry", { key: "port" }, "5433") // Pastikan port benar
    .up()
    .ele("entry", { key: "database" }, "gis_bpn")
    .up()
    .ele("entry", { key: "user" }, "postgres")
    .up()
    .ele("entry", { key: "passwd" }, "super.admin")
    .up()
    .ele("entry", { key: "dbtype" }, "postgis")
    .up()
    .ele("entry", { key: "schema" }, "public")
    .up()
    .ele("entry", { key: "Expose primary keys" }, "true") // Tambahkan ini
    .end({ pretty: true });

  try {
    await axios.post(url, datastoreXML, {
      auth,
      headers: { "Content-Type": "text/xml" },
    });

    logger.info(`| GeoServer | - Datastore '${datastore}' berhasil dibuat.`);
  } catch (err) {
    const msg = err.response?.data || err.message;
    logger.error(`| GeoServer | - Gagal membuat datastore: ${msg}`);
    throw new Error("Gagal membuat datastore di GeoServer");
  }
}

// Cek apakah layer sudah publish
async function isLayerPublished(layerName) {
  try {
    const url = `${baseURL}/layers/${workspace}:${layerName}`;
    const response = await axios.get(url, { auth });
    logger.info(`| GeoServer | - Layer sudah ada: ${layerName}`);
    return response.status === 200;
  } catch (err) {
    if (err.response?.status === 404) {
      logger.info(`| GeoServer | - Layer belum ada: ${layerName}`);
      return false;
    }
    logger.error(`| GeoServer | - Gagal cek layer: ${err.message}`);
    throw new Error("Gagal cek status layer di GeoServer");
  }
}

// Publish layer
async function publishPostGISLayer(layerName) {
  await ensureWorkspaceExists(); // tambahkan ini
  await ensureDatastoreExists();

  try {
    const dsUrl = `${baseURL}/workspaces/${workspace}/datastores/${datastore}/featuretypes.json`;
    const response = await axios.get(dsUrl, { auth });
    logger.info(`Datastore connection verified: ${response.status}`);
  } catch (err) {
    logger.error(`Datastore connection failed: ${err.message}`);
    throw new Error("Koneksi datastore gagal, periksa konfigurasi PostGIS");
  }

  const alreadyPublished = await isLayerPublished(layerName);
  if (alreadyPublished) return true;

  const url = `${baseURL}/workspaces/${workspace}/datastores/${datastore}/featuretypes`;

  const featureTypeXML = xmlbuilder
    .create("featureType")
    .ele("name", layerName)
    .up()
    .ele("nativeName", layerName)
    .up()
    .ele("title", layerName)
    .up()
    .ele("srs", "EPSG:4326")
    .up()
    .ele("enabled", "true")
    .up()
    .ele("store", { class: "dataStore" })
    .ele("name", `${workspace}:${datastore}`)
    .up()
    .ele("maxFeatures", "0")
    .up()
    .ele("numDecimals", "8")
    .up()
    .ele("attributes")
    .end({ pretty: true });

  try {
    logger.info(`| GeoServer | - Mempublish layer: ${layerName}`);
    const response = await axios.post(url, featureTypeXML, {
      auth,
      headers: { "Content-Type": "text/xml" },
    });

    logger.info(`| GeoServer | - Berhasil publish layer: ${layerName}`);
    return response.status === 201 || response.status === 200;
  } catch (err) {
    let errorMsg = `Gagal publish layer ${layerName}`;
    if (err.response) {
      errorMsg += `\nStatus: ${err.response.status}`;
      if (err.response.data && typeof err.response.data === "string") {
        errorMsg += `\nData: ${err.response.data}`;
      }
    } else {
      errorMsg += `\nError: ${err.message}`;
    }
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
}

module.exports = {
  publishPostGISLayer,
  isLayerPublished,
};
