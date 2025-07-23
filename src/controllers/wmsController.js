const axios = require("axios");
const wmsConfig = require("../config/wmsConfig");
const logger = require("../utils/logger");
const WithDataResource = require("../resources/WithDataResource");
const WithoutDataResource = require("../resources/WithoutDataResource");

// ========== GET WMS CONTROLLER ==========
exports.getWMSImage = async (req, res) => {
  try {
    const { width, height, format } = req.query;

    // Gunakan parameter default dari config
    const params = {
      ...wmsConfig.defaultParams,
      width: width || wmsConfig.defaultParams.width,
      height: height || wmsConfig.defaultParams.height,
      format: format || wmsConfig.defaultParams.format,
    };

    // const wmsResponse = await axios.get(wmsConfig.baseUrl, {
    //   responseType: "arraybuffer",
    //   params,
    // });

    // Konversi buffer menjadi Base64
    // const imageBase64 = Buffer.from(wmsResponse.data).toString("base64");
    // const imageDataUri = `data:${params.format};base64,${imageBase64}`;

    logger.info("| Get WMS Image | - Success to get WMS image.");

    const response = new WithDataResource(
      200,
      "WMS_SUCCESS",
      "Peta Berhasil Diambil",
      "Data WMS berhasil diambil dari GeoServer.",
      {
        contentType: params.format,
        url: `${wmsConfig.baseUrl}?${new URLSearchParams(params).toString()}`,
        // dataUri: imageDataUri,
      }
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| WMS | - Error function getWMSImage: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};
