const wkx = require("wkx");

function convertShapefileRowsToGeoJSON(rows, geometryColumn = "geom") {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      type: "FeatureCollection",
      features: [],
    };
  }

  const features = rows.map((row) => {
    // Clone data agar tidak merusak objek asli
    const rowData = { ...row };
    const geomHex = rowData[geometryColumn];

    // Buang kolom geom dari properties
    delete rowData[geometryColumn];

    let geometry;
    try {
      geometry = wkx.Geometry.parse(Buffer.from(geomHex, "hex")).toGeoJSON();
    } catch (error) {
      geometry = null;
    }

    return {
      type: "Feature",
      geometry,
      properties: rowData,
    };
  });

  return {
    type: "FeatureCollection",
    features,
  };
}

module.exports = {
  convertShapefileRowsToGeoJSON,
};
