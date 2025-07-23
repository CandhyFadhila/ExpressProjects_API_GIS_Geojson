const knex = require("../config/database");

async function resolveArrayRelations(value, table) {
  if (!value) return [];

  let ids = [];

  // Parse JSON jika belum array
  if (Array.isArray(value)) {
    ids = value;
  } else {
    try {
      ids = JSON.parse(value);
    } catch {
      ids = [];
    }
  }

  if (!ids.length) return [];

  // Ambil dokumen + join relasi users
  const results = await knex(`${table} as d`)
    .whereIn("d.id", ids)
    .leftJoin("users as u1", "d.uploaded_by", "u1.id")
    .leftJoin("users as u2", "d.verified_by", "u2.id")
    .select(
      "d.*",
      knex.raw(`
        json_build_object(
          'id', u1.id,
          'name', u1.name,
          'email', u1.email,
          'register_at', u1.register_at,
          'last_login', u1.last_login,
          'created_at', u1.created_at,
          'updated_at', u1.updated_at,
          'deleted_at', u1.deleted_at
        ) as uploaded_user
      `),
      knex.raw(`
        json_build_object(
          'id', u2.id,
          'name', u2.name,
          'email', u2.email,
          'register_at', u2.register_at,
          'last_login', u2.last_login,
          'created_at', u2.created_at,
          'updated_at', u2.updated_at,
          'deleted_at', u2.deleted_at
        ) as verified_user
      `)
    );

  // Urutkan sesuai urutan ID input
  const idMap = new Map(results.map((doc) => [doc.id, doc]));
  return ids.map((id) => idMap.get(id)).filter(Boolean);
}

module.exports = { resolveArrayRelations };
