function getOgrConfigByEnv(
  shpFilePath,
  tableName,
  schemaName = "public",
  hasPRJ,
  srcSrs,
  assume4326
) {
  const env = process.env.PG_ENV || "windows";
  const baseEnvWin = {
    PROJ_DATA: "C:\\Program Files\\QGIS 3.44.0\\share\\proj",
    PROJ_LIB: "C:\\Program Files\\QGIS 3.44.0\\share\\proj",
    GDAL_DATA: "C:\\Program Files\\QGIS 3.44.0\\apps\\gdal\\share\\gdal",
    PATH: `C:\\Program Files\\QGIS 3.44.0\\bin;${process.env.PATH}`,
  };

  // Tentukan flag reprojection
  // - Jika ada .prj: cukup -t_srs 4326 (ogr tahu sumbernya dari .prj)
  // - Jika tidak ada .prj tapi pengguna kasih srcSrs: -s_srs <src> -t_srs 4326
  // - Jika assume4326: -a_srs 4326 (tanpa transform)
  // - Else: jangan kasih -t_srs (biar tidak error), biarkan helper sebelumnya memblokir
  let reprojFlags = "";
  if (assume4326) {
    reprojFlags = `-a_srs EPSG:4326`;
  } else if (srcSrs) {
    reprojFlags = `-s_srs ${srcSrs} -t_srs EPSG:4326`;
  } else if (hasPRJ) {
    reprojFlags = `-t_srs EPSG:4326`;
  }

  // Layer creation options:
  // - FID=fid: hindari konflik bila DBF sudah punya kolom "id"
  // - PRECISION=NO: varchar tidak dikunci panjang (hindari alter panjang kolom)
  // - SPATIAL_INDEX=GIST: buat index spasial otomatis (GDAL PG driver)
  const lco = `-lco GEOMETRY_NAME=geom -lco FID=fid -lco LAUNDER=NO -lco PRECISION=NO -lco SPATIAL_INDEX=GIST`;
  // Catatan, jika mau dikembalikan ke lowercase, hilangkan "-lco LAUNDER=NO"

  // General options:
  // -nlt PROMOTE_TO_MULTI , -dim XY -> aman untuk Z/M
  // -gt 65536 -> batch besar; -skipfailures (opsional, uncomment kalau mau tahan banting)
  const general = `-nln "${schemaName}"."${tableName}" -nlt PROMOTE_TO_MULTI -dim XY ${lco} -overwrite -gt 65536 ${reprojFlags}`;
  // const general = `-nln ... ${lco} -overwrite -gt 65536 ${reprojFlags} -skipfailures`; // jika mau skip fitur gagal


  const src = `"${shpFilePath}"`;

  if (env === "linux") {
    const ogrPath = "ogr2ogr";
    const ogrCmd = `${ogrPath} -f "PostgreSQL" PG:"host=localhost user=gisuser dbname=gisdb password=password_kuat port=5432" ${src} ${general}`;
    return { ogrPath, ogrCmd, env: process.env };
  } else {
    const ogrPath = `"C:\\Program Files\\QGIS 3.44.0\\bin\\ogr2ogr.exe"`;
    const ogrCmd = `${ogrPath} -f "PostgreSQL" PG:"host=localhost user=postgres dbname=gis_bpn_v2 password=super.admin port=5433" ${src} ${general}`;
    return { ogrPath, ogrCmd, env: { ...process.env, ...baseEnvWin } };
  }
}

module.exports = { getOgrConfigByEnv };
