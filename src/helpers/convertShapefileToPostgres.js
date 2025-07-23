const { exec } = require("child_process");
const logger = require("../utils/logger");

async function convertShapefileToPostgres(
  shpFilePath,
  tableName,
  schemaName = "public"
) {
  // Gunakan path lengkap ke ogr2ogr.exe
  // const ogrPath = `"C:\\Program Files\\QGIS 3.44.0\\bin\\ogr2ogr.exe"`; // <- windows
  const ogrPath = "ogr2ogr"; // <- linux

  // const ogrCmd = `${ogrPath} -f "PostgreSQL" PG:"host=localhost user=postgres dbname=gis_bpn password=super.admin port=5433" "${shpFilePath}" -nln ${schemaName}.${tableName} -nlt MULTIPOLYGON -lco GEOMETRY_NAME=geom -lco FID=id -overwrite -t_srs EPSG:4326`; // <- windows

  const ogrCmd = `${ogrPath} -f "PostgreSQL" PG:"host=localhost user=gisuser dbname=gisdb password=password_kuat port=5432" "${shpFilePath}" -nln ${schemaName}.${tableName} -nlt MULTIPOLYGON -lco GEOMETRY_NAME=geom -lco FID=id -overwrite -t_srs EPSG:4326`; // <- linux

  logger.info(`| convertShapefile | Eksekusi perintah: ${ogrCmd}`);

  return new Promise((resolve, reject) => {
    exec(ogrCmd, (error, stdout, stderr) => {
      if (error) {
        logger.error(`| convertShapefile | Gagal: ${error.message}`);
        return reject(new Error("Gagal mengimpor shapefile ke PostgreSQL"));
      }

      if (stderr) logger.warn(`| convertShapefile | STDERR: ${stderr}`);
      if (stdout) logger.info(`| convertShapefile | STDOUT: ${stdout}`);

      resolve(`Berhasil impor shapefile ke tabel ${schemaName}.${tableName}`);
    });
  });
}

module.exports = { convertShapefileToPostgres };
