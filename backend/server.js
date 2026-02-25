const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Parse quality data to extract doublons and baseline counts
const parseQualiteActe = (qualiteActeData) => {
  let doublons = 0;
  let baseline = 0;
  
  if (qualiteActeData && typeof qualiteActeData === 'object') {
    // Extract doublon count
    if (qualiteActeData.doublon && Array.isArray(qualiteActeData.doublon)) {
      doublons = qualiteActeData.doublon.reduce((total, item) => {
        return total + (item.images ? item.images.length : 0);
      }, 0);
    }
    
    // Extract baseline count
    if (qualiteActeData.baseline && Array.isArray(qualiteActeData.baseline)) {
      baseline = qualiteActeData.baseline.reduce((total, item) => {
        return total + (item.images ? item.images.length : 0);
      }, 0);
    }
  }
  
  return { doublons, baseline };
};
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'gestion_lots',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'arh$2017'
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Database connected successfully at:', res.rows[0].now);
  }
});

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

// Database health check
app.get('/api/db-health', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM controle');
    res.json({ 
      status: 'OK', 
      message: 'Database connected',
      record_count: parseInt(result.rows[0].count)
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'Error', 
      message: 'Database connection failed',
      error: error.message 
    });
  }
});

// Get all controle records
app.get('/api/controle', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM controle ORDER BY date_debut DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching controle data:', error);
    res.status(500).json({ error: 'Failed to fetch controle data' });
  }
});

// Get controle by Num_lot
app.get('/api/controle/:Num_lot', async (req, res) => {
  try {
    const { Num_lot } = req.params;
    const result = await pool.query('SELECT * FROM controle WHERE "Num_lot" = $1', [Num_lot]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Controle record not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching controle record:', error);
    res.status(500).json({ error: 'Failed to fetch controle record' });
  }
});

// Get statistics by controleur
app.get('/api/stats/controleur', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        login_controleur,
        COUNT(*) as nb_lots,
        SUM(nb_actes_traites) as total_actes_traites,
        SUM(nb_actes_rejets) as total_actes_rejets,
        AVG(nb_actes_traites) as avg_actes_traites,
        AVG(nb_actes_rejets) as avg_actes_rejets
      FROM controle 
      GROUP BY login_controleur
      ORDER BY nb_lots DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching controleur stats:', error);
    res.status(500).json({ error: 'Failed to fetch controleur statistics' });
  }
});

// Get general statistics
app.get('/api/stats/general', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_lots,
        SUM(nb_actes_traites) as total_actes_traites,
        SUM(nb_actes_rejets) as total_actes_rejets,
        COUNT(DISTINCT login_controleur) as nb_controleurs,
        MIN(date_debut) as first_date,
        MAX(date_fin) as last_date
      FROM controle
    `);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching general stats:', error);
    res.status(500).json({ error: 'Failed to fetch general statistics' });
  }
});

// Import JSON data to database
app.post('/api/import', upload.single('jsonFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No JSON file uploaded' });
    }

    const fs = require('fs');
    const jsonData = JSON.parse(fs.readFileSync(req.file.path, 'utf8'));
    
    // Handle single object or array of objects
    const data = Array.isArray(jsonData) ? jsonData : [jsonData];
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const item of data) {
      try {
        const query = `
          INSERT INTO controle (
            "Num_lot", arborescence, login_controleur, login_scan, 
            date_debut, date_fin, nb_actes_traites, nb_actes_rejets, 
            tentative, doublons, baseline
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
          ) ON CONFLICT ("Num_lot") DO UPDATE SET
            arborescence = EXCLUDED.arborescence,
            login_controleur = EXCLUDED.login_controleur,
            login_scan = EXCLUDED.login_scan,
            date_debut = EXCLUDED.date_debut,
            date_fin = EXCLUDED.date_fin,
            nb_actes_traites = EXCLUDED.nb_actes_traites,
            nb_actes_rejets = EXCLUDED.nb_actes_rejets,
            tentative = EXCLUDED.tentative,
            doublons = EXCLUDED.doublons,
            baseline = EXCLUDED.baseline
        `;

        await pool.query(query, [
          item.Num_lot,
          item.arborescence || null,
          item.login_controleur || null,
          item.login_scan || '0',
          item.date_debut ? new Date(item.date_debut) : null,
          item.date_fin ? new Date(item.date_fin) : null,
          item.nb_actes_traites || 0,
          item.nb_actes_rejets || 0,
          item.tentative || 0,
          item.doublons || 0,
          item.baseline || 0
        ]);

        successCount++;
      } catch (error) {
        errorCount++;
        errors.push({
          Num_lot: item.Num_lot,
          error: error.message
        });
      }
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      message: 'Import completed',
      total_records: data.length,
      success_count: successCount,
      error_count: errorCount,
      errors: errors
    });

  } catch (error) {
    console.error('Error importing data:', error);
    
    // Clean up uploaded file if it exists
    if (req.file && req.file.path) {
      try {
        const fs = require('fs');
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }
    
    res.status(500).json({ 
      error: 'Failed to import data',
      details: error.message 
    });
  }
});

// Import JSON data directly (without file upload)
app.post('/api/import/json', async (req, res) => {
  try {
    const jsonData = req.body;
    
    if (!jsonData) {
      return res.status(400).json({ error: 'No JSON data provided' });
    }

    // Handle single object or array of objects
    const data = Array.isArray(jsonData) ? jsonData : [jsonData];
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const item of data) {
      try {
        const query = `
          INSERT INTO controle (
            "Num_lot", arborescence, login_controleur, login_scan, 
            date_debut, date_fin, nb_actes_traites, nb_actes_rejets, 
            tentative, doublons, baseline
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
          ) ON CONFLICT ("Num_lot") DO UPDATE SET
            arborescence = EXCLUDED.arborescence,
            login_controleur = EXCLUDED.login_controleur,
            login_scan = EXCLUDED.login_scan,
            date_debut = EXCLUDED.date_debut,
            date_fin = EXCLUDED.date_fin,
            nb_actes_traites = EXCLUDED.nb_actes_traites,
            nb_actes_rejets = EXCLUDED.nb_actes_rejets,
            tentative = EXCLUDED.tentative,
            doublons = EXCLUDED.doublons,
            baseline = EXCLUDED.baseline
        `;

        await pool.query(query, [
          item.Num_lot,
          item.arborescence || null,
          item.login_controleur || null,
          item.login_scan || '0',
          item.date_debut ? new Date(item.date_debut) : null,
          item.date_fin ? new Date(item.date_fin) : null,
          item.nb_actes_traites || 0,
          item.nb_actes_rejets || 0,
          item.tentative || 0,
          item.doublons || 0,
          item.baseline || 0
        ]);

        successCount++;
      } catch (error) {
        errorCount++;
        errors.push({
          Num_lot: item.Num_lot,
          error: error.message
        });
      }
    }

    res.json({
      message: 'Import completed',
      total_records: data.length,
      success_count: successCount,
      error_count: errorCount,
      errors: errors
    });

  } catch (error) {
    console.error('Error importing JSON data:', error);
    res.status(500).json({ 
      error: 'Failed to import JSON data',
      details: error.message 
    });
  }
});

// Import ZIP file and process all JSON files inside
app.post('/api/import/zip', upload.single('zipFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No ZIP file uploaded' });
    }

    const zip = new AdmZip(req.file.path);
    const entries = zip.getEntries();
    
    let totalFiles = 0;
    let processedFiles = 0;
    let errorFiles = 0;
    const errors = [];
    const processedData = [];

    // Create temp directory for extraction
    const tempDir = path.join(__dirname, 'temp', Date.now().toString());
    if (!fs.existsSync(path.join(__dirname, 'temp'))) {
      fs.mkdirSync(path.join(__dirname, 'temp'));
    }
    fs.mkdirSync(tempDir);

    try {
      // Extract all files
      zip.extractAllTo(tempDir, true);

      // Find all JSON files recursively
      const findJsonFiles = (dir, basePath = '') => {
        const files = [];
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const relativePath = basePath ? path.join(basePath, item) : item;
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            files.push(...findJsonFiles(fullPath, relativePath));
          } else if (item.toLowerCase().endsWith('.json')) {
            files.push({
              path: fullPath,
              relativePath: relativePath.replace(/\\/g, '/'),
              arborescence: basePath ? basePath.replace(/\\/g, '/') : ''
            });
          }
        }
        return files;
      };

      const jsonFiles = findJsonFiles(tempDir);
      totalFiles = jsonFiles.length;

      // Process each JSON file
      for (const file of jsonFiles) {
        try {
          const content = fs.readFileSync(file.path, 'utf8');
          const jsonData = JSON.parse(content);
          
          // Handle single object or array of objects
          const data = Array.isArray(jsonData) ? jsonData : [jsonData];
          
          for (const item of data) {
            // Add arborescence from file path if not present
            if (!item.arborescence && file.arborescence) {
              item.arborescence = file.arborescence;
            }
            
            // Parse quality data if present
            if (item.qualite_acte) {
              const { doublons, baseline } = parseQualiteActe(item.qualite_acte);
              item.doublons = doublons;
              item.baseline = baseline;
            }
            
            processedData.push(item);
          }
          
          processedFiles++;
        } catch (error) {
          errorFiles++;
          errors.push({
            file: file.relativePath,
            error: error.message
          });
        }
      }

      // Import all processed data to database
      let successCount = 0;
      let errorCount = 0;
      const importErrors = [];

      for (const item of processedData) {
        try {
          const query = `
            INSERT INTO controle (
              "Num_lot", arborescence, login_controleur, login_scan, 
              date_debut, date_fin, nb_actes_traites, nb_actes_rejets, 
              tentative, doublons, baseline
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
            ) ON CONFLICT ("Num_lot") DO UPDATE SET
              arborescence = EXCLUDED.arborescence,
              login_controleur = EXCLUDED.login_controleur,
              login_scan = EXCLUDED.login_scan,
              date_debut = EXCLUDED.date_debut,
              date_fin = EXCLUDED.date_fin,
              nb_actes_traites = EXCLUDED.nb_actes_traites,
              nb_actes_rejets = EXCLUDED.nb_actes_rejets,
              tentative = EXCLUDED.tentative,
              doublons = EXCLUDED.doublons,
              baseline = EXCLUDED.baseline
          `;

          await pool.query(query, [
            item.Num_lot || item.num_lot,
            item.arborescence || null,
            item.login_controleur || item.controleur || null,
            item.login_scan || item.agent_scan || '0',
            item.date_debut ? new Date(item.date_debut) : null,
            item.date_fin ? new Date(item.date_fin) : null,
            item.nb_actes_traites || 0,
            item.nb_actes_rejets || 0,
            item.tentative || 0,
            item.doublons || 0,
            item.baseline || 0
          ]);

          successCount++;
        } catch (error) {
          errorCount++;
          importErrors.push({
            Num_lot: item.Num_lot || item.num_lot,
            error: error.message
          });
        }
      }

      // Clean up
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.unlinkSync(req.file.path);

      res.json({
        message: 'ZIP import completed',
        zip_info: {
          total_json_files: totalFiles,
          processed_files: processedFiles,
          error_files: errorFiles,
          file_errors: errors
        },
        import_info: {
          total_records: processedData.length,
          success_count: successCount,
          error_count: errorCount,
          import_errors: importErrors
        }
      });

    } catch (error) {
      // Clean up on error
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      throw error;
    }

  } catch (error) {
    console.error('Error importing ZIP:', error);
    res.status(500).json({ 
      error: 'Failed to import ZIP file',
      details: error.message 
    });
  }
});

// Get all files (no path)
app.get('/api/files', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM controle ORDER BY arborescence, "Num_lot"');
    
    // Group files by arborescence
    const groupedFiles = result.rows.reduce((acc, file) => {
      const arbo = file.arborescence || 'root';
      if (!acc[arbo]) {
        acc[arbo] = [];
      }
      acc[arbo].push(file);
      return acc;
    }, {});

    res.json({
      path: '',
      total_files: result.rows.length,
      grouped_files: groupedFiles,
      files: result.rows
    });

  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Get files in a specific arborescence path
app.get('/api/files/*', async (req, res) => {
  try {
    const requestPath = req.params[0] || '';
    
    // Query database for files with matching arborescence
    const query = `SELECT * FROM controle WHERE arborescence LIKE $1 ORDER BY arborescence, "Num_lot"`;
    const params = [`${requestPath}%`];
    
    const result = await pool.query(query, params);
    
    // Group files by arborescence
    const groupedFiles = result.rows.reduce((acc, file) => {
      const arbo = file.arborescence || 'root';
      if (!acc[arbo]) {
        acc[arbo] = [];
      }
      acc[arbo].push(file);
      return acc;
    }, {});

    res.json({
      path: requestPath,
      total_files: result.rows.length,
      grouped_files: groupedFiles,
      files: result.rows
    });

  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Browse arborescence structure
app.get('/api/browse', async (req, res) => {
  try {
    const { path = '', level = 1 } = req.query;
    
    // Get unique arborescence paths
    const result = await pool.query(`
      SELECT DISTINCT 
        arborescence,
        COUNT(*) as file_count,
        COUNT(DISTINCT login_controleur) as controleur_count,
        SUM(nb_actes_traites) as total_actes,
        SUM(nb_actes_rejets) as total_rejets,
        SUM(doublons) as total_doublons,
        SUM(baseline) as total_baseline
      FROM controle 
      WHERE arborescence LIKE $1
      GROUP BY arborescence
      ORDER BY arborescence
    `, [path ? `${path}%` : '%']);

    // Build tree structure
    const buildTree = (items, currentPath = '') => {
      const tree = {};
      
      items.forEach(item => {
        if (!item.arborescence) {
          tree['root'] = {
            path: '',
            file_count: item.file_count,
            controleur_count: item.controleur_count,
            total_actes: item.total_actes,
            total_rejets: item.total_rejets,
            total_doublons: item.total_doublons,
            total_baseline: item.total_baseline,
            children: {}
          };
        } else {
          const parts = item.arborescence.split('/').filter(p => p);
          let current = tree;
          
          parts.forEach((part, index) => {
            const partPath = parts.slice(0, index + 1).join('/');
            if (!current[part]) {
              current[part] = {
                path: partPath,
                file_count: 0,
                controleur_count: 0,
                total_actes: 0,
                total_rejets: 0,
                total_doublons: 0,
                total_baseline: 0,
                children: {}
              };
            }
            
            if (item.arborescence === partPath) {
              current[part].file_count = item.file_count;
              current[part].controleur_count = item.controleur_count;
              current[part].total_actes = item.total_actes;
              current[part].total_rejets = item.total_rejets;
              current[part].total_doublons = item.total_doublons;
              current[part].total_baseline = item.total_baseline;
            }
            
            current = current[part].children;
          });
        }
      });
      
      return tree;
    };

    const tree = buildTree(result.rows, path);

    res.json({
      current_path: path,
      total_arborescences: result.rows.length,
      tree: tree,
      flat_list: result.rows
    });

  } catch (error) {
    console.error('Error browsing arborescence:', error);
    res.status(500).json({ error: 'Failed to browse arborescence' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
