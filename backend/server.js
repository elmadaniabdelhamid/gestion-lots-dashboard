const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

// Import connexion to database
const pool = require('./db');

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
// Test route to check database connection
app.get('/api/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as current_time');
    res.json({ 
      status: 'OK', 
      database: 'Connectée',
      time: result.rows[0].current_time 
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      message: error.message 
    });
  }
});
// ....Other routes here

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API disponible sur http://localhost:${PORT}`);

  pool.query('SELECT NOW()', (err, result) => {
    if (err) {
      console.error('Échec connexion DB:', err.message);
    } else {
      console.log('Base de données connectée');
    }
  });
});

