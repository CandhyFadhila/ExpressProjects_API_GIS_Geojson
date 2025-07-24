const { exec } = require("child_process");
const { Client } = require("pg");
const logger = require("../utils/logger");

async function convertShapefileToPostgres(
  shpFilePath,
  tableName,
  schemaName = "public"
) {
  // Gunakan path lengkap ke ogr2ogr.exe
  const ogrPath = `"C:\\Program Files\\QGIS 3.44.0\\bin\\ogr2ogr.exe"`; // <- windows
  // const ogrPath = "ogr2ogr"; // <- linux

  const ogrCmd = `${ogrPath} -f "PostgreSQL" PG:"host=localhost user=postgres dbname=gis_bpn password=super.admin port=5433" "${shpFilePath}" -nln ${schemaName}.${tableName} -nlt MULTIPOLYGON -lco GEOMETRY_NAME=geom -lco FID=id -overwrite -t_srs EPSG:4326`; // <- windows

  // const ogrCmd = `${ogrPath} -f "PostgreSQL" PG:"host=localhost user=gisuser dbname=gisdb password=password_kuat port=5432" "${shpFilePath}" -nln ${schemaName}.${tableName} -nlt MULTIPOLYGON -lco GEOMETRY_NAME=geom -lco FID=id -overwrite -t_srs EPSG:4326`; // <- linux

  logger.info(`| convertShapefile | Eksekusi perintah: ${ogrCmd}`);

  return new Promise((resolve, reject) => {
    exec(ogrCmd, async (error, stdout, stderr) => {
      if (error) {
        logger.error(`| convertShapefile | Gagal: ${error.message}`);
        return reject(new Error("Gagal mengimpor shapefile ke PostgreSQL"));
      }

      if (stderr) logger.warn(`| convertShapefile | STDERR: ${stderr}`);
      if (stdout) logger.info(`| convertShapefile | STDOUT: ${stdout}`);

      // Jika konversi berhasil, lanjutkan untuk memeriksa dan memperbaiki panjang kolom
      try {
        await checkAndFixCharacterVaryingLength(schemaName, tableName);
        resolve(`Berhasil impor shapefile ke tabel ${schemaName}.${tableName}`);
      } catch (err) {
        logger.error(`| convertShapefile | Gagal memeriksa kolom: ${err.message}`);
        reject(new Error("Gagal memeriksa kolom setelah konversi shapefile"));
      }
    });
  });
}

async function checkAndFixCharacterVaryingLength(schemaName, tableName) {
  // Menggunakan pg untuk mengakses PostgreSQL dan memeriksa kolom dengan tipe character varying
  // const client = new Client({
  //   host: "localhost",          // -> linux
  //   user: "gisuser",
  //   database: "gisdb",
  //   password: "password_kuat",
  //   port: 5432,
  // });

  const client = new Client({
    host: "localhost",          // -> windows
    user: "postgres",
    database: "gis_bpn",
    password: "super.admin",
    port: 5433,
  });

  try {
    await client.connect();
    const query = `
      SELECT column_name, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = $1
      AND table_name = $2
      AND data_type = 'character varying';
    `;
    const res = await client.query(query, [schemaName, tableName]);

    // Jika ada kolom character varying dengan panjang < 254, lakukan perubahan
    const columnsToUpdate = res.rows.filter(
      (row) => row.character_maximum_length < 254
    );

    if (columnsToUpdate.length > 0) {
      logger.info(
        `| convertShapefile | Kolom dengan panjang kurang dari 254 ditemukan: ${columnsToUpdate
          .map((row) => row.column_name)
          .join(", ")}`
      );
      for (const column of columnsToUpdate) {
        const alterQuery = `
          ALTER TABLE ${schemaName}.${tableName}
          ALTER COLUMN ${column.column_name} SET DATA TYPE character varying(254);
        `;
        await client.query(alterQuery);
        logger.info(
          `| convertShapefile | Panjang kolom ${column.column_name} diubah menjadi 254`
        );
      }
    } else {
      logger.info(
        `| convertShapefile | Semua kolom sudah memiliki panjang >= 254`
      );
    }
  } catch (err) {
    throw new Error(
      `Error saat memeriksa dan memperbaiki panjang kolom: ${err.message}`
    );
  } finally {
    await client.end();
  }
}

module.exports = { convertShapefileToPostgres };
