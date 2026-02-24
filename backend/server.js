const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// TODO: Add routes for:
// - POST /api/upload - Upload ZIP file
// - POST /api/lots - Process and store lot data
// - GET /api/controllers - Get all controllers
// - GET /api/lots - Get all lots with filters
// - GET /api/stats - Get dashboard statistics

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
