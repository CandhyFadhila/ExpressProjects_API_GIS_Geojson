function getOgrConfigByEnv(shpFilePath, tableName, schemaName = "public") {
  const env = process.env.PG_ENV || "windows";
  const baseEnvWin = {
    PROJ_DATA: "C:\\Program Files\\QGIS 3.44.0\\share\\proj",
    PROJ_LIB: "C:\\Program Files\\QGIS 3.44.0\\share\\proj",
    GDAL_DATA: "C:\\Program Files\\QGIS 3.44.0\\apps\\gdal\\share\\gdal",
    PATH: `C:\\Program Files\\QGIS 3.44.0\\bin;${process.env.PATH}`,
  };

  // Catatan, jika mau dikembalikan ke lowercase, hilangkan "-lco LAUNDER=NO"
  if (env === "linux") {
    const ogrPath = "ogr2ogr";
    const ogrCmd = `${ogrPath} -f "PostgreSQL" PG:"host=localhost user=gisuser dbname=gisdb password=password_kuat port=5432" "${shpFilePath}" -nln "${schemaName}"."${tableName}" -nlt MULTIPOLYGON -lco GEOMETRY_NAME=geom -lco FID=id -lco LAUNDER=NO -overwrite -t_srs EPSG:4326`;
    return { ogrPath, ogrCmd, env: process.env };
  } else {
    const ogrPath = `"C:\\Program Files\\QGIS 3.44.0\\bin\\ogr2ogr.exe"`;
    const ogrCmd = `${ogrPath} -f "PostgreSQL" PG:"host=localhost user=postgres dbname=gis_bpn_v2 password=super.admin port=5433" "${shpFilePath}" -nln "${schemaName}"."${tableName}" -nlt MULTIPOLYGON -lco GEOMETRY_NAME=geom -lco FID=id -lco LAUNDER=NO -overwrite -t_srs EPSG:4326`;
    return { ogrPath, ogrCmd, env: { ...process.env, ...baseEnvWin } };
  }
}

module.exports = { getOgrConfigByEnv };
