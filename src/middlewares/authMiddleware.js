const jwt = require("jsonwebtoken");
const WithoutDataResource = require("../resources/WithoutDataResource");
const { isTokenBlacklisted } = require("../utils/tokenBlacklist");
const logger = require("../utils/logger");

// Middleware untuk autentikasi menggunakan JWT
const authMiddleware = async (req, res, next) => {
  // Ambil token dari header Authorization
  const token = req.header("Authorization")?.replace("Bearer ", "");

  // Jika tidak ada token
  if (!token) {
    const response = new WithoutDataResource(
      401, // HTTP Status Code: Unauthorized
      "TOKEN_NOT_FOUND",
      "Akses ditolak",
      "Token tidak ditemukan. Pastikan Anda sudah login dan menyertakan token dalam header request."
    );
    logger.info(
      `| Auth | - Token tidak ditemukan di request, at ${new Date().toISOString()}`
    );
    return res.status(401).json(response.toResponse());
  }

  // Cek apakah token sudah di-blacklist
  const blacklisted = await isTokenBlacklisted(token);
  if (blacklisted) {
    const response = new WithoutDataResource(
      401,
      "TOKEN_BLACKLISTED",
      "Akses ditolak",
      "Sesi login Anda telah berakhir. Silakan login kembali."
    );
    return res.status(401).json(response.toResponse());
  }

  // Verifikasi token
  jwt.verify(token, "secretkey", (err, decoded) => {
    if (err && err.name === "TokenExpiredError") {
      const response = new WithoutDataResource(
        401, // HTTP Status Code: Unauthorized
        "TOKEN_EXPIRED",
        "Akses ditolak",
        "Token sudah kedaluwarsa. Silakan login kembali."
      );
      logger.info(
        `| Auth | - Token expired for user with token: ${token}, at ${new Date().toISOString()}`
      );
      return res.status(401).json(response.toResponse());
    }

    if (err) {
      const response = new WithoutDataResource(
        401, // HTTP Status Code: Unauthorized
        "INVALID_TOKEN",
        "Akses ditolak",
        "Token tidak valid. Silakan login kembali."
      );
      logger.info(`| Auth | - Invalid token, at ${new Date().toISOString()}`);
      return res.status(401).json(response.toResponse());
    }

    // Jika token valid, simpan informasi user di request untuk digunakan di route selanjutnya
    req.userId = decoded.userId;
    logger.info(
      `| Auth | - Token valid for userId: ${
        decoded.userId
      }, at ${new Date().toISOString()}`
    );
    next();
  });
};

module.exports = authMiddleware;
