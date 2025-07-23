module.exports = {
  baseUrl: "http://localhost:8080/geoserver/bpn-gis/wms",
  defaultParams: {
    service: "WMS",
    version: "1.1.0",
    request: "GetMap",
    layers: "bpn-gis:Update_Data_PTPNI_from_postgis",
    styles: "",
    bbox: "396028.90625,373072.03125,502899.75,432816.34375",
    width: 800,
    height: 600,
    srs: "EPSG:4326",
    format: "image/svg",
  },
};
