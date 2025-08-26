const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const { getPgClientByEnv } = require("../helpers/pgClient");
const { getOgrConfigByEnv } = require("../helpers/ogrHelper");
const logger = require("../utils/logger");

async function convertShapefileToPostgres(
  shpFilePath,
  tableName,
  schemaName = "public",
  layerId = null,
  withExplanation = false,
  ogrOpts = {}
) {
  const { hasPRJ, srcSrs, assume4326 } = ogrOpts;

  // Gunakan path lengkap ke ogr2ogr.exe
  const { ogrCmd, env } = getOgrConfigByEnv(
    shpFilePath,
    tableName,
    schemaName,
    hasPRJ,
    srcSrs,
    assume4326
  );
  logger.info(`| convertShapefile | Eksekusi perintah: ${ogrCmd}`);

  try {
    // 1. Eksekusi perintah ogr2ogr
    const { stdout, stderr } = await execAsync(ogrCmd, {
      env,
      maxBuffer: 1024 * 1024 * 20,
      timeout: 300000,
      windowsHide: true,
    });

    if (stderr) logger.warn(`| convertShapefile | STDERR: ${stderr}`);
    if (stdout) logger.info(`| convertShapefile | STDOUT: ${stdout}`);

    // 2. Tunggu hingga tabel benar-benar tersedia
    const clientCheck = await getPgClientByEnv();
    try {
      let retries = 10;
      let tableExists = false;

      while (retries > 0) {
        const result = await clientCheck.query(
          `SELECT to_regclass('"${schemaName}"."${tableName}"') AS exists`
        );

        if (result.rows[0].exists) {
          tableExists = true;
          break;
        }

        retries--;
        logger.info(
          `| convertShapefile | Menunggu tabel "${tableName}" tersedia... (${
            10 - retries
          }/10)`
        );
        await new Promise((res) => setTimeout(res, 500)); // delay 0.5 detik
      }

      if (!tableExists) {
        throw new Error(
          `Tabel "${schemaName}"."${tableName}" tidak ditemukan setelah import.`
        );
      }
    } finally {
      await clientCheck.end();
    }

    // 3. (opsional tapi direkomendasikan) pastikan geometry kolom sesuai 4326 & MultiPolygon
    await ensureGeomIsMultiPolygon4326(schemaName, tableName, assume4326);

    // 4. Tambahkan kolom
    await alterTableForMeta(schemaName, tableName); //Required

    if (withExplanation) {
      await addExplanationColumnsIfNeeded(schemaName, tableName); //Required | Optional
    }

    // 4. Perbaiki panjang kolom jika perlu
    // await checkAndFixCharacterVaryingLength(schemaName, tableName); //Optional

    // 5. Isi layer_id jika ada
    if (layerId) {
      const client = await getPgClientByEnv();
      try {
        await client.query(
          `UPDATE "${schemaName}"."${tableName}" SET layer_id = $1`,
          [layerId]
        );
        logger.info(
          `| convertShapefile | Semua baris di tabel ${schemaName}.${tableName} berhasil diisi layer_id = ${layerId}`
        );
      } catch (err) {
        logger.warn(
          `| convertShapefile | Gagal mengisi layer_id: ${err.message}`
        );
      } finally {
        await client.end();
      }
    }

    return `Berhasil impor shapefile dan modifikasi kolom di tabel ${schemaName}.${tableName}`;
  } catch (err) {
    logger.error(`| convertShapefile | Gagal: ${err.message}`);
    throw new Error("Gagal memproses shapefile ke PostgreSQL");
  }
}

// Tambah kolom layer_id dan document_ids
async function alterTableForMeta(schemaName, tableName) {
  const client = await getPgClientByEnv();

  try {
    // 1. Tambahkan kolom layer_id jika belum ada
    await client.query(`
      ALTER TABLE "${schemaName}"."${tableName}"
      ADD COLUMN IF NOT EXISTS layer_id BIGINT;
    `);

    // 2. Tambahkan kolom document_ids jika belum ada
    await client.query(`
      ALTER TABLE "${schemaName}"."${tableName}"
      ADD COLUMN IF NOT EXISTS document_ids JSONB DEFAULT '[]';
    `);

    // 3. Tambahkan kolom color jika belum ada
    await client.query(`
      ALTER TABLE "${schemaName}"."${tableName}"
      ADD COLUMN IF NOT EXISTS color VARCHAR(9);
    `);

    logger.info(
      `| alterTableForMeta | Kolom layer_id, document_ids, dan color berhasil ditambahkan pada ${schemaName}.${tableName}`
    );
  } catch (err) {
    throw new Error(
      `Gagal menambahkan kolom/constraint ke tabel: ${err.message}`
    );
  } finally {
    await client.end();
  }
}

async function addExplanationColumnsIfNeeded(schemaName, tableName) {
  const client = await getPgClientByEnv();
  const columnsToCheck = ["PARAPIHAKB", "PERMASALAH", "TINDAKLANJ", "HASIL"];

  try {
    const res = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
    `,
      [schemaName, tableName]
    );

    const existingColumns = res.rows.map((row) => row.column_name);

    const columnsToAdd = columnsToCheck.filter(
      (col) => !existingColumns.includes(col)
    );

    for (const col of columnsToAdd) {
      try {
        await client.query(`
          ALTER TABLE "${schemaName}"."${tableName}"
          ADD COLUMN "${col}" TEXT;
        `);
        logger.info(
          `| addExplanationColumnsIfNeeded | Kolom ${col} berhasil ditambahkan ke ${schemaName}.${tableName}`
        );
      } catch (colErr) {
        logger.warn(
          `| addExplanationColumnsIfNeeded | Gagal menambahkan kolom ${col} ke ${schemaName}.${tableName}: ${colErr.message}`
        );
      }
    }

    // Jika tidak ada kolom yang ditambahkan
    if (columnsToAdd.length === 0) {
      logger.info(
        `| addExplanationColumnsIfNeeded | Semua kolom sudah ada di ${schemaName}.${tableName}, tidak ada yang ditambahkan.`
      );
    }
  } catch (err) {
    logger.error(
      `| addExplanationColumnsIfNeeded | Error utama: ${err.message}`
    );
    throw new Error(
      `Gagal memproses pengecekan dan penambahan kolom penjelasan`
    );
  } finally {
    await client.end();
  }
}

// Pastikan kolom geom bertipe MultiPolygon SRID 4326 (aman jika sudah benar)
async function ensureGeomIsMultiPolygon4326(schemaName, tableName, assume4326) {
  const client = await getPgClientByEnv();
  try {
    // Jika kita 'assume_4326' atau memakai transform ke 4326, paksa tipe & SRID
    const sql = `
      DO $$
      DECLARE
        v_schema text := ${
          client.escapeLiteral
            ? client.escapeLiteral(schemaName)
            : `'${schemaName}'`
        };
        v_table  text := ${
          client.escapeLiteral
            ? client.escapeLiteral(tableName)
            : `'${tableName}'`
        };
      BEGIN
        EXECUTE format(
          'ALTER TABLE %I.%I ALTER COLUMN geom TYPE geometry(MultiPolygon,4326) USING ST_SetSRID(ST_Force2D(geom),4326);',
          ${schemaName ? `'${schemaName}'` : "NULL"},
          ${tableName ? `'${tableName}'` : "NULL"}
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Jika kolom geom tidak ada / tipe bukan polygon (mis import data line/point), biarkan saja.
          -- Logging dikerjakan di JS saja.
          NULL;
      END $$;
    `;
    await client.query(sql);
  } catch (e) {
    // cukup log; jangan buat proses gagal hanya karena cast tipe gagal
    // (misalnya layer bukan polygon)
  } finally {
    await client.end();
  }
}

// Update kolom shp jadi lowercase
async function checkAndFixCharacterVaryingLength(schemaName, tableName) {
  const client = await getPgClientByEnv();

  try {
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
          ALTER TABLE "${schemaName}"."${tableName}"
          ALTER COLUMN "${column.column_name}" SET DATA TYPE character varying(254);
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
