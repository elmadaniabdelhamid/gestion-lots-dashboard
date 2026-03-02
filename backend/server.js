const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const StreamZip = require('node-stream-zip');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const { Worker } = require('worker_threads');
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
    // Ensure uploads directory exists
    if (!fs.existsSync('uploads')) {
      fs.mkdirSync('uploads', { recursive: true });
    }
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500 MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Only accept ZIP files
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.originalname.toLowerCase().endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'), false);
    }
  }
});

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
        // Parse qualite_acte to extract doublons and baseline
        const { doublons, baseline } = parseQualiteActe(item.qualite_acte);
        
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
          item.login_controleur || 'agent de controle',
          item.login_scan || 'agent de scan',
          item.date_debut ? new Date(item.date_debut) : null,
          item.date_fin ? new Date(item.date_fin) : null,
          item.nb_actes_traites || 0,
          item.nb_actes_rejets || 0,
          item.tentative || 0,
          doublons,
          baseline
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
        // Parse qualite_acte to extract doublons and baseline
        const { doublons, baseline } = parseQualiteActe(item.qualite_acte);
        
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
          item.login_controleur || 'agent de controle',
          item.login_scan || 'agent de scan',
          item.date_debut ? new Date(item.date_debut) : null,
          item.date_fin ? new Date(item.date_fin) : null,
          item.nb_actes_traites || 0,
          item.nb_actes_rejets || 0,
          item.tentative || 0,
          doublons,
          baseline
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

// Bulk insert helper function with transaction
async function bulkInsertData(data) {
  if (data.length === 0) return { success: 0, errors: [] };
  
  const client = await pool.connect();
  const CHUNK_SIZE = 500; // Insert 500 rows at a time to avoid parameter limit
  let successCount = 0;
  const errors = [];
  
  try {
    await client.query('BEGIN');
    
    // Process in chunks
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      
      // Validate and filter out invalid records
      const validChunk = chunk.filter(item => {
        const numLotInt = parseInt(item.Num_lot);
        if (isNaN(numLotInt) || numLotInt === null || numLotInt === undefined) {
          console.warn(`[DB INSERT] ❌ Skipping invalid record: invalid Num_lot (not an integer)`, { 
            Num_lot: item.Num_lot,
            arborescence: item.arborescence 
          });
          errors.push({ record: item, error: 'Num_lot must be a valid integer' });
          return false;
        }
        return true;
      });
      
      if (validChunk.length === 0) {
        console.log(`[DB INSERT] Chunk ${Math.floor(i / CHUNK_SIZE) + 1} had no valid records, skipping...`);
        continue;
      }
      
      console.log(`[DB INSERT] Inserting chunk ${Math.floor(i / CHUNK_SIZE) + 1} with ${validChunk.length} records...`);
      
      // Build bulk insert query
      const values = validChunk.map((_, index) => {
        const offset = index * 12;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12})`;
      }).join(',');
      
      const flatValues = validChunk.flatMap(item => [
        item.Num_lot,
        item.arborescence,
        item.login_controleur,
        item.login_scan,
        item.date_debut,
        item.date_fin,
        item.nb_actes_traites,
        item.nb_actes_rejets,
        item.tentative,
        item.doublons,
        item.baseline,
        item.source_file
      ]);
      
      const query = `
        INSERT INTO controle 
        ("Num_lot", arborescence, login_controleur, login_scan, date_debut, date_fin, 
         nb_actes_traites, nb_actes_rejets, tentative, doublons, baseline, source_file)
        VALUES ${values}
        ON CONFLICT ("Num_lot") DO UPDATE SET
          arborescence = EXCLUDED.arborescence,
          login_controleur = EXCLUDED.login_controleur,
          login_scan = EXCLUDED.login_scan,
          date_debut = EXCLUDED.date_debut,
          date_fin = EXCLUDED.date_fin,
          nb_actes_traites = EXCLUDED.nb_actes_traites,
          nb_actes_rejets = EXCLUDED.nb_actes_rejets,
          tentative = EXCLUDED.tentative,
          doublons = EXCLUDED.doublons,
          baseline = EXCLUDED.baseline,
          source_file = EXCLUDED.source_file
      `;
      
      await client.query(query, flatValues);
      successCount += validChunk.length;
    }
    
    await client.query('COMMIT');
    return { success: successCount, errors };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Process files using Worker Thread Pool
async function processWithWorkerPool(zip, jsonFiles, sourceFile, poolSize = 4) {
  const allData = [];
  const errors = [];
  
  console.log(`[ZIP IMPORT] Using Worker Thread Pool with ${poolSize} workers`);
  
  // Create worker pool queue
  const queue = [...jsonFiles];
  let activeWorkers = 0;
  let processedCount = 0;
  
  return new Promise((resolve) => {
    const processNext = async () => {
      // Check if we're done
      if (queue.length === 0 && activeWorkers === 0) {
        resolve({ allData, errors });
        return;
      }
      
      // Process next file if queue has items and we have capacity
      while (queue.length > 0 && activeWorkers < poolSize) {
        const entry = queue.shift();
        activeWorkers++;
        
        // Extract file content
        try {
          const content = await zip.entryData(entry.name);
          const jsonContent = content.toString('utf8');
          
          // Create and run worker
          const worker = new Worker(path.join(__dirname, 'zipWorker.js'), {
            workerData: {
              jsonContent,
              entryName: entry.name,
              sourceFile
            }
          });
          
          worker.on('message', (result) => {
            activeWorkers--;
            processedCount++;
            
            if (result.success) {
              if (result.data && result.data.length > 0) {
                allData.push(...result.data);
              }
            } else {
              console.error(`[ZIP IMPORT] ❌ Worker error for ${result.entryName}:`, result.error);
              errors.push({
                file: result.entryName,
                error: result.error
              });
            }
            
            // Log progress every 50 files
            if (processedCount % 50 === 0 || processedCount === jsonFiles.length) {
              console.log(`[ZIP IMPORT] Processed ${processedCount}/${jsonFiles.length} files (${Math.round(processedCount / jsonFiles.length * 100)}%)`);
            }
            
            // Continue processing
            processNext();
          });
          
          worker.on('error', (error) => {
            activeWorkers--;
            processedCount++;
            console.error(`[ZIP IMPORT] ❌ Worker thread error for ${entry.name}:`, error.message);
            errors.push({
              file: entry.name,
              error: error.message
            });
            processNext();
          });
          
          worker.on('exit', (code) => {
            if (code !== 0) {
              console.error(`[ZIP IMPORT] ❌ Worker stopped with exit code ${code} for ${entry.name}`);
            }
          });
          
        } catch (error) {
          activeWorkers--;
          processedCount++;
          console.error(`[ZIP IMPORT] ❌ Error extracting ${entry.name}:`, error.message);
          errors.push({
            file: entry.name,
            error: error.message
          });
          processNext();
        }
      }
    };
    
    // Start processing
    processNext();
  });
}

// Import ZIP file with optimized processing (simplified for reliability)
app.post('/api/import/zip', (req, res) => {
  upload.single('zipFile')(req, res, async (err) => {
    // Handle multer errors
    if (err) {
      console.error('[ZIP IMPORT] ❌ Upload error:', err.message);
      
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'File too large',
          details: 'Maximum file size is 500 MB'
        });
      }
      
      return res.status(400).json({
        success: false,
        error: 'Upload failed',
        details: err.message
      });
    }
    
    // Continue with ZIP processing
    await handleZipImport(req, res);
  });
});

// Separated ZIP import handler for cleaner error handling
async function handleZipImport(req, res) {
  const startTime = Date.now();
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No ZIP file uploaded' });
    }

    const zipPath = req.file.path;
    const sourceFile = req.file.originalname;
    console.log(`[ZIP IMPORT] Processing file: ${zipPath} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

    let zip;
    let entries;
    
    try {
      zip = new StreamZip.async({ file: zipPath });
      console.log(`[ZIP IMPORT] ZIP file opened successfully`);
      entries = await zip.entries();
      console.log(`[ZIP IMPORT] ZIP entries read: ${Object.keys(entries).length} total entries`);
    } catch (zipError) {
      console.error(`[ZIP IMPORT] ❌ Failed to open/read ZIP file:`, zipError.message);
      throw new Error(`ZIP extraction failed: ${zipError.message}. The file may be corrupted or not a valid ZIP archive.`);
    }
    
    // Filter JSON files
    const jsonFiles = Object.values(entries).filter(
      entry => !entry.isDirectory && entry.name.toLowerCase().endsWith('.json')
    );

    console.log(`[ZIP IMPORT] Found ${jsonFiles.length} JSON files to process`);

    // Process files with Worker Thread Pool (optimal poolSize = CPU cores)
    const workerPoolSize = Math.min(os.cpus().length, 8); // Max 8 workers
    
    const { allData, errors } = await processWithWorkerPool(zip, jsonFiles, sourceFile, workerPoolSize);

    await zip.close();
    
    console.log(`[ZIP IMPORT] Extraction complete. Inserting ${allData.length} records into database...`);

    // Bulk insert into database
    let importResult = { success: 0, errors: [] };
    if (allData.length > 0) {
      importResult = await bulkInsertData(allData);
    }

    // Cleanup
    fs.unlinkSync(zipPath);
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[ZIP IMPORT] Completed in ${totalTime}s. Success: ${importResult.success}, Errors: ${errors.length}`);

    res.json({
      success: true,
      message: 'ZIP import completed',
      processing_time_seconds: parseFloat(totalTime),
      zip_info: {
        total_json_files: jsonFiles.length,
        processed_files: jsonFiles.length - errors.length,
        error_files: errors.length,
        file_errors: errors.length > 0 ? errors.slice(0, 10) : []
      },
      import_info: {
        total_records: allData.length,
        success_count: importResult.success,
        error_count: importResult.errors.length
      }
    });

  } catch (error) {
    console.error('[ZIP IMPORT] ❌ FATAL ERROR:', {
      message: error.message,
      stack: error.stack,
      file: req.file?.originalname,
      size: req.file?.size
    });
    
    // Cleanup on error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('[ZIP IMPORT] Failed to cleanup file:', cleanupError.message);
      }
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to import ZIP file',
      details: error.message,
      suggestion: 'Check if the file is a valid ZIP archive and not corrupted. Try re-uploading the file.'
    });
  }
}

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

// Export comprehensive report
app.get('/api/export/report', async (req, res) => {
  try {
    const { format = 'csv' } = req.query;
    
    // Get comprehensive data
    const [
      generalStats,
      controleurStats,
      dailyPerformance
    ] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*) as total_lots,
          SUM(nb_actes_traites) as total_actes_traites,
          SUM(nb_actes_rejets) as total_actes_rejets,
          MIN(date_debut) as date_premiere,
          MAX(date_fin) as date_derniere
        FROM controle
      `),
      pool.query(`
        SELECT 
          COALESCE(login_controleur, 'Non spécifié') as controleur,
          SUM(nb_actes_traites) as total_actes_controlees,
          SUM(nb_actes_rejets) as total_erreurs,
          ROUND(CAST(
            CASE 
              WHEN SUM(nb_actes_traites) > 0 
              THEN (SUM(nb_actes_rejets)::float / SUM(nb_actes_traites) * 100) 
              ELSE 0 
            END AS numeric
          ), 3) as taux_erreur
        FROM controle 
        GROUP BY login_controleur
        ORDER BY controleur
      `),
      pool.query(`
        SELECT 
          COALESCE(login_controleur, 'Non spécifié') as controleur,
          DATE(date_debut) as date_lot,
          COUNT(DISTINCT "Num_lot") as total_lots,
          SUM(nb_actes_traites) as total_actes
        FROM controle 
        WHERE date_debut IS NOT NULL
        GROUP BY login_controleur, DATE(date_debut)
        ORDER BY DATE(date_debut), login_controleur
      `)
    ]);

    const gs = generalStats.rows[0];
    const timestamp = new Date().toLocaleString('fr-FR');

    // Build daily performance matrix with BOTH lots and actes (shared by CSV and Excel)
    const dateMap = new Map();
    const controllerMap = new Map();
    
    dailyPerformance.rows.forEach(row => {
      const dateStr = new Date(row.date_lot).toLocaleDateString('fr-FR');
      const controller = row.controleur;
      const lots = parseInt(row.total_lots) || 0;
      const actes = parseInt(row.total_actes) || 0;
      
      if (!dateMap.has(dateStr)) {
        dateMap.set(dateStr, new Date(row.date_lot));
      }
      
      if (!controllerMap.has(controller)) {
        controllerMap.set(controller, new Map());
      }
      
      controllerMap.get(controller).set(dateStr, { lots, actes });
    });
    
    const sortedDates = Array.from(dateMap.entries())
      .sort((a, b) => a[1] - b[1])
      .map(entry => entry[0]);
    
    const sortedControllers = Array.from(controllerMap.keys()).sort();

    if (format === 'csv') {
      // Generate CSV with new format (Lots and Actes columns)
      const lines = [];
      
      // Header row with dates
      const headerRow = ['Chef d\'équipe'];
      sortedDates.forEach(date => {
        headerRow.push(`${date} - Lots`);
        headerRow.push(`${date} - Actes`);
      });
      lines.push(headerRow.join(','));
      
      // Data rows
      const dailyLotsTotal = new Map();
      const dailyActesTotal = new Map();
      sortedDates.forEach(date => {
        dailyLotsTotal.set(date, 0);
        dailyActesTotal.set(date, 0);
      });
      
      sortedControllers.forEach(controller => {
        const row = [controller];
        sortedDates.forEach(date => {
          const data = controllerMap.get(controller).get(date) || { lots: 0, actes: 0 };
          row.push(data.lots || '');
          row.push(data.actes || '');
          dailyLotsTotal.set(date, dailyLotsTotal.get(date) + data.lots);
          dailyActesTotal.set(date, dailyActesTotal.get(date) + data.actes);
        });
        lines.push(row.join(','));
      });
      
      // Total général row
      const totalRow = ['Total général'];
      sortedDates.forEach(date => {
        totalRow.push(dailyLotsTotal.get(date));
        totalRow.push(dailyActesTotal.get(date));
      });
      lines.push(totalRow.join(','));
      lines.push('');
      lines.push('');
      
      // Error statistics table
      lines.push('Chef d\'équipe,Nbr d\'image Controlee,Nbr d\'erreur détecté,Taux d\'erreur');
      controleurStats.rows.forEach(c => {
        lines.push(`${c.controleur},${c.total_actes_controlees},${c.total_erreurs},${c.taux_erreur}%`);
      });
      lines.push('');
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="rapport_gestion_lots.csv"`);
      res.send('\uFEFF' + lines.join('\n'));
    } else if (format === 'excel' || format === 'xlsx') {
      // Generate styled Excel file matching the new format
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Rapport Performance');

      // TABLE 1: Daily Performance Matrix
      // Row 1: Date headers (merged cells)
      const dateHeaderRow = worksheet.getRow(1);
      dateHeaderRow.getCell(1).value = 'Chef d\'equipe';
      
      sortedDates.forEach((date, idx) => {
        const startCol = 2 + (idx * 2); // Each date takes 2 columns
        dateHeaderRow.getCell(startCol).value = date;
        // Merge cells for date header
        worksheet.mergeCells(1, startCol, 1, startCol + 1);
      });
      
      // Add Total column header (merged)
      const totalColStart = 2 + (sortedDates.length * 2);
      dateHeaderRow.getCell(totalColStart).value = 'Total';
      worksheet.mergeCells(1, totalColStart, 1, totalColStart + 1);
      
      // Style date header row
      dateHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      dateHeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' } // Blue color matching screenshot
      };
      dateHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
      dateHeaderRow.height = 20;
      dateHeaderRow.eachCell(cell => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      // Row 2: Sub-headers (Lots / Actes)
      const subHeaderRow = worksheet.getRow(2);
      subHeaderRow.getCell(1).value = ''; // Empty cell under "Chef d'equipe"
      
      sortedDates.forEach((date, idx) => {
        const startCol = 2 + (idx * 2);
        subHeaderRow.getCell(startCol).value = 'Lots';
        subHeaderRow.getCell(startCol + 1).value = 'Actes';
      });
      
      // Add Total sub-headers (reuse totalColStart from above)
      subHeaderRow.getCell(totalColStart).value = 'Actes';
      subHeaderRow.getCell(totalColStart + 1).value = 'Lots';
      
      // Style sub-header row
      subHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      subHeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      subHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
      subHeaderRow.height = 20;
      subHeaderRow.eachCell(cell => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      // Add controller data rows
      const dailyLotsTotal = new Map();
      const dailyActesTotal = new Map();
      sortedDates.forEach(date => {
        dailyLotsTotal.set(date, 0);
        dailyActesTotal.set(date, 0);
      });
      
      let currentRow = 3;
      sortedControllers.forEach(controller => {
        const dataRow = worksheet.getRow(currentRow);
        dataRow.getCell(1).value = controller;
        
        let controllerTotalLots = 0;
        let controllerTotalActes = 0;
        
        sortedDates.forEach((date, idx) => {
          const startCol = 2 + (idx * 2);
          const data = controllerMap.get(controller).get(date) || { lots: 0, actes: 0 };
          
          dataRow.getCell(startCol).value = data.lots || '';
          dataRow.getCell(startCol + 1).value = data.actes || '';
          
          controllerTotalLots += data.lots;
          controllerTotalActes += data.actes;
          
          dailyLotsTotal.set(date, dailyLotsTotal.get(date) + data.lots);
          dailyActesTotal.set(date, dailyActesTotal.get(date) + data.actes);
        });
        
        // Add Total column for this controller (reuse totalColStart)
        dataRow.getCell(totalColStart).value = controllerTotalActes;
        dataRow.getCell(totalColStart + 1).value = controllerTotalLots;
        
        // Style data row
        dataRow.eachCell((cell, colNumber) => {
          if (colNumber === 1) {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
          } else {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          }
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
        
        currentRow++;
      });

      // Add Total général row
      const totalRow = worksheet.getRow(currentRow);
      totalRow.getCell(1).value = 'Total general';
      
      let grandTotalLots = 0;
      let grandTotalActes = 0;
      
      sortedDates.forEach((date, idx) => {
        const startCol = 2 + (idx * 2);
        const lots = dailyLotsTotal.get(date);
        const actes = dailyActesTotal.get(date);
        totalRow.getCell(startCol).value = lots;
        totalRow.getCell(startCol + 1).value = actes;
        grandTotalLots += lots;
        grandTotalActes += actes;
      });
      
      // Add grand total in the Total column (reuse totalColStart)
      totalRow.getCell(totalColStart).value = grandTotalActes;
      totalRow.getCell(totalColStart + 1).value = grandTotalLots;
      
      totalRow.font = { bold: true };
      totalRow.eachCell((cell, colNumber) => {
        if (colNumber === 1) {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }
        cell.border = {
          top: { style: 'medium' },
          left: { style: 'thin' },
          bottom: { style: 'medium' },
          right: { style: 'thin' }
        };
      });

      currentRow++;
      
      // Add spacing
      currentRow++;
      currentRow++;

      // TABLE 2: Quality Metrics
      const table2HeaderRow = worksheet.getRow(currentRow);
      table2HeaderRow.getCell(1).value = 'Chef d\'equipe';
      table2HeaderRow.getCell(2).value = 'Nbr d\'image Controlee';
      table2HeaderRow.getCell(3).value = 'Nbr d erreur detecte';
      table2HeaderRow.getCell(4).value = 'Taux d\'erreur';
      
      // Style header row 2
      table2HeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      table2HeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      table2HeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
      table2HeaderRow.height = 20;
      [1, 2, 3, 4].forEach(col => {
        table2HeaderRow.getCell(col).border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      currentRow++;

      // Add quality data rows
      controleurStats.rows.forEach(c => {
        const qualityRow = worksheet.getRow(currentRow);
        qualityRow.getCell(1).value = c.controleur;
        qualityRow.getCell(2).value = c.total_actes_controlees;
        qualityRow.getCell(3).value = c.total_erreurs;
        qualityRow.getCell(4).value = `${c.taux_erreur}%`;
        
        [1, 2, 3, 4].forEach(col => {
          const cell = qualityRow.getCell(col);
          if (col === 1) {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
          } else {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          }
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
        
        currentRow++;
      });

      // Set column widths
      worksheet.getColumn(1).width = 20; // Chef d'equipe column
      // Set widths for date columns (Lots and Actes) + Total columns
      const totalColumns = 1 + (sortedDates.length * 2) + 2; // +2 for Total (Actes and Lots)
      for (let i = 2; i <= totalColumns; i++) {
        worksheet.getColumn(i).width = 12;
      }
      // Set widths for error table
      worksheet.getColumn(2).width = 22; // Nbr d'image Controlee
      worksheet.getColumn(3).width = 22; // Nbr d erreur detecte
      worksheet.getColumn(4).width = 15; // Taux d'erreur

      // Send Excel file
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="rapport_gestion_lots.xlsx"`);
      
      await workbook.xlsx.write(res);
      res.end();
    } else {
      // JSON format
      const report = {
        metadata: {
          date_generation: timestamp,
          type_rapport: 'Rapport de Performance Quotidienne',
          periode: {
            debut: gs.date_premiere,
            fin: gs.date_derniere
          }
        },
        statistiques_generales: {
          total_lots: parseInt(gs.total_lots),
          total_actes_traites: parseInt(gs.total_actes_traites || 0),
          total_actes_rejets: parseInt(gs.total_actes_rejets || 0)
        },
        performance_quotidienne: dailyPerformance.rows,
        metriques_qualite: controleurStats.rows
      };
      
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="rapport_gestion_lots.json"`);
      res.json(report);
    }

  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ 
      error: 'Failed to generate report',
      details: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
