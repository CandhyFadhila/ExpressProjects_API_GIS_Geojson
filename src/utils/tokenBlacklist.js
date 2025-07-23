const redisClient = require("../config/redisClient");

// Tambahkan token ke blacklist
const blacklistToken = async (token, expirationInSeconds) => {
  await redisClient.setEx(`blacklist:${token}`, expirationInSeconds, "true");
};

// Cek apakah token ada di blacklist
const isTokenBlacklisted = async (token) => {
  const result = await redisClient.get(`blacklist:${token}`);
  return result === "true";
};

module.exports = {
  blacklistToken,
  isTokenBlacklisted,
};
