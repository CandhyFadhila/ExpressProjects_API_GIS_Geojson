require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const knex = require("./config/database");
const authRoutes = require("./routes/authRoutes");
const wmsRoutes = require("./routes/wmsRoutes");
const path = require("path");
const documentRoutes = require("./routes/documentRoutes");
const workspaceRoutes = require("./routes/workspaceRoutes");
const workspaceLayerRoutes = require("./routes/workspaceLayerRoutes");
const corsMiddleware = require("./middlewares/cors");

const app = express();

// Middleware
app.use(corsMiddleware);
app.use(express.json());
app.use(morgan("dev"));

// Cek API root
app.get("/", (req, res) => {
  res.json({ message: "Welcome to the API GIS!" });
});

// Cek db
app.get("/check-db", async (req, res) => {
  try {
    const result = await knex.raw("SELECT NOW()");
    res.json({
      status: "success",
      message: "Koneksi database berhasil.",
      server_time: result.rows[0].now,
    });
  } catch (error) {
    logger.error("DB Connection Error:", error.message);
    res.status(500).json({
      status: "error",
      message: "Gagal terhubung ke database.",
      error: error.message,
    });
  }
});

// Route API
app.use("/api", authRoutes);

// Route WMS
app.use("/api/gis-bpn/public-request", wmsRoutes);

// Route Documents
app.use("/storage", express.static(path.join(__dirname, "public", "storage")));
app.use("/api/gis-bpn/documents", documentRoutes);

// Route Workspace
app.use("/api/gis-bpn/workspaces", workspaceRoutes);

// Route Workspace Layer
app.use("/api/gis-bpn/workspace-layers", workspaceLayerRoutes);

// Jalankan server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
