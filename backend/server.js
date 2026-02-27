const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const StreamZip = require('node-stream-zip');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
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
          item.login_controleur || 'agent de controle',
          item.login_scan || 'agent de scan',
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
          item.login_controleur || 'agent de controle',
          item.login_scan || 'agent de scan',
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
        if (!item.Num_lot || item.Num_lot === 'null' || item.Num_lot === 'undefined' || String(item.Num_lot).trim() === '') {
          console.warn(`[DB INSERT] ❌ Skipping invalid record: missing/invalid Num_lot`, { 
            Num_lot: item.Num_lot,
            arborescence: item.arborescence 
          });
          errors.push({ record: item, error: 'Missing or invalid Num_lot' });
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
        const offset = index * 11;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`;
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
        item.baseline
      ]);
      
      const query = `
        INSERT INTO controle 
        ("Num_lot", arborescence, login_controleur, login_scan, date_debut, date_fin, 
         nb_actes_traites, nb_actes_rejets, tentative, doublons, baseline)
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
          baseline = EXCLUDED.baseline
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

// Process single file from ZIP (simplified, more reliable)
async function processZipFile(zip, entry) {
  try {
    const content = await zip.entryData(entry.name);
    const jsonData = JSON.parse(content.toString('utf8'));
    
    // Handle single object or array of objects
    const dataArray = Array.isArray(jsonData) ? jsonData : [jsonData];
    const results = [];
    
    for (const item of dataArray) {
      // Extract arborescence from file path
      const pathParts = entry.name.split('/');
      pathParts.pop(); // Remove filename
      const arborescence = pathParts.join('/');
      
      // Parse quality data if present
      let doublons = 0;
      let baseline = 0;
      if (item.qualite_acte) {
        const qualityData = parseQualiteActe(item.qualite_acte);
        doublons = qualityData.doublons;
        baseline = qualityData.baseline;
      }
      
      // Extract Num_lot - use filename as fallback if missing
      let numLot = item.Num_lot || item.num_lot || item.numero_lot;
      
      // If still null/undefined, use filename without extension
      if (!numLot || numLot === 'null' || numLot === 'undefined' || String(numLot).trim() === '') {
        numLot = path.basename(entry.name, '.json');
        console.log(`[ZIP IMPORT] Using filename as Num_lot for ${entry.name}: ${numLot}`);
      }
      
      // Final validation - skip if still invalid
      if (!numLot || String(numLot).trim() === '') {
        console.warn(`[ZIP IMPORT] ❌ Skipping entry in ${entry.name}: invalid Num_lot`);
        errors.push({ file: entry.name, error: 'Missing or invalid Num_lot' });
        continue;
      }
      
      results.push({
        Num_lot: String(numLot).trim(),
        arborescence: item.arborescence || arborescence || null,
        login_controleur: item.login_controleur || item.controleur || 'agent de controle',
        login_scan: item.login_scan || item.agent_scan || 'agent de scan',
        date_debut: item.date_debut ? new Date(item.date_debut) : null,
        date_fin: item.date_fin ? new Date(item.date_fin) : null,
        nb_actes_traites: parseInt(item.nb_actes_traites) || 0,
        nb_actes_rejets: parseInt(item.nb_actes_rejets) || 0,
        tentative: parseInt(item.tentative) || 0,
        doublons: item.doublons || doublons || 0,
        baseline: item.baseline || baseline || 0
      });
    }
    
    return results;
  } catch (error) {
    console.error(`Error processing ${entry.name}:`, error.message);
    return null;
  }
}

// Import ZIP file with optimized processing (simplified for reliability)
app.post('/api/import/zip', upload.single('zipFile'), async (req, res) => {
  const startTime = Date.now();
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No ZIP file uploaded' });
    }

    const zipPath = req.file.path;
    console.log(`[ZIP IMPORT] Processing file: ${zipPath} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

    const zip = new StreamZip.async({ file: zipPath });
    const entries = await zip.entries();
    
    // Filter JSON files
    const jsonFiles = Object.values(entries).filter(
      entry => !entry.isDirectory && entry.name.toLowerCase().endsWith('.json')
    );

    console.log(`[ZIP IMPORT] Found ${jsonFiles.length} JSON files to process`);

    const allData = [];
    const errors = [];
    
    // Process in parallel batches (10 files at a time)
    const BATCH_SIZE = 10;
    
    for (let i = 0; i < jsonFiles.length; i += BATCH_SIZE) {
      const batch = jsonFiles.slice(i, i + BATCH_SIZE);
      
      // Process batch in parallel
      const batchPromises = batch.map(entry => processZipFile(zip, entry));
      const results = await Promise.all(batchPromises);
      
      // Collect results
      results.forEach((result, index) => {
        if (result && result.length > 0) {
          allData.push(...result);
        } else if (result === null) {
          errors.push({
            file: batch[index].name,
            error: 'Failed to process file'
          });
        }
      });
      
      // Log progress every 50 files
      if ((i + BATCH_SIZE) % 50 === 0 || i + BATCH_SIZE >= jsonFiles.length) {
        const processed = Math.min(i + BATCH_SIZE, jsonFiles.length);
        console.log(`[ZIP IMPORT] Processed ${processed}/${jsonFiles.length} files (${Math.round(processed / jsonFiles.length * 100)}%)`);
      }
    }

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
    console.error('[ZIP IMPORT] Error:', error);
    
    // Cleanup on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      success: false,
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
          SUM(nb_actes_traites) as total_actes
        FROM controle 
        WHERE date_debut IS NOT NULL
        GROUP BY login_controleur, DATE(date_debut)
        ORDER BY DATE(date_debut), login_controleur
      `)
    ]);

    const gs = generalStats.rows[0];
    const timestamp = new Date().toLocaleString('fr-FR');
    const filename = `rapport-gestion-lots-${Date.now()}`;

    if (format === 'csv') {
      // Generate CSV (legacy)
      const lines = [];
      lines.push('Chef d\'équipe,' + sortedDates.join(','));
      const dailyTotals = new Map();
      sortedDates.forEach(date => dailyTotals.set(date, 0));
      sortedControllers.forEach(controller => {
        const row = [controller];
        sortedDates.forEach(date => {
          const value = controllerMap.get(controller).get(date) || 0;
          row.push(value);
          dailyTotals.set(date, dailyTotals.get(date) + value);
        });
        lines.push(row.join(','));
      });
      const totalRow = ['Total général'];
      sortedDates.forEach(date => totalRow.push(dailyTotals.get(date)));
      lines.push(totalRow.join(','));
      lines.push('');
      lines.push('');
      lines.push('Chef d\'équipe,Nbr d\'image contrôlé,Nbr d\'erreur détecté,Taux d\'erreur,Objectif');
      controleurStats.rows.forEach(c => {
        lines.push(`${c.controleur},${c.total_actes_controlees},${c.total_erreurs},${c.taux_erreur}%,1%`);
      });
      lines.push('');
      lines.push('--- FIN DU RAPPORT ---');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send('\uFEFF' + lines.join('\n'));
    } else if (format === 'excel' || format === 'xlsx') {
      // Generate styled Excel file
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Rapport Performance');

      // Build daily performance matrix
      const dateMap = new Map();
      const controllerMap = new Map();
      
      dailyPerformance.rows.forEach(row => {
        const dateStr = new Date(row.date_lot).toLocaleDateString('fr-FR');
        const controller = row.controleur;
        const actes = parseInt(row.total_actes) || 0;
        
        if (!dateMap.has(dateStr)) {
          dateMap.set(dateStr, new Date(row.date_lot));
        }
        
        if (!controllerMap.has(controller)) {
          controllerMap.set(controller, new Map());
        }
        
        controllerMap.get(controller).set(dateStr, actes);
      });
      
      const sortedDates = Array.from(dateMap.entries())
        .sort((a, b) => a[1] - b[1])
        .map(entry => entry[0]);
      
      const sortedControllers = Array.from(controllerMap.keys()).sort();

      // TABLE 1: Daily Performance
      const headerRow1 = ['Agent de controle$', ...sortedDates];
      const table1StartRow = 1;
      const table1HeaderRow = worksheet.addRow(headerRow1);
      
      // Style header row 1
      table1HeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      table1HeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF000000' }
      };
      table1HeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
      table1HeaderRow.eachCell(cell => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      // Add controller data rows
      const dailyTotals = new Map();
      sortedDates.forEach(date => dailyTotals.set(date, 0));
      
      sortedControllers.forEach(controller => {
        const rowData = [controller];
        sortedDates.forEach(date => {
          const value = controllerMap.get(controller).get(date) || 0;
          rowData.push(value);
          dailyTotals.set(date, dailyTotals.get(date) + value);
        });
        const dataRow = worksheet.addRow(rowData);
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
      });

      // Add Total général row
      const totalRowData = ['Total général'];
      sortedDates.forEach(date => totalRowData.push(dailyTotals.get(date)));
      const totalRow = worksheet.addRow(totalRowData);
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

      // Add spacing
      worksheet.addRow([]);
      worksheet.addRow([]);

      // TABLE 2: Quality Metrics
      const table2HeaderRow = worksheet.addRow([
        'Agent de controle$',
        'Nbr d\'image contrôlé',
        'Nbr d\'erreur détecté',
        'Taux d\'erreur',
        'Objectif'
      ]);
      
      // Style header row 2
      table2HeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      table2HeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF000000' }
      };
      table2HeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
      table2HeaderRow.eachCell(cell => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      // Add quality data rows
      controleurStats.rows.forEach(c => {
        const qualityRow = worksheet.addRow([
          c.controleur,
          c.total_actes_controlees,
          c.total_erreurs,
          `${c.taux_erreur}%`,
          '1%'
        ]);
        
        qualityRow.eachCell((cell, colNumber) => {
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
          
          // Highlight error rate if above objective
          if (colNumber === 4 && parseFloat(c.taux_erreur) > 1.0) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFF6B6B' }
            };
            cell.font = { bold: true };
          } else if (colNumber === 4) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FF90EE90' }
            };
          }
        });
      });

      // Add footer
      worksheet.addRow([]);
      const footerRow = worksheet.addRow(['--- FIN DU RAPPORT ---']);
      footerRow.font = { italic: true };

      // Auto-fit columns
      worksheet.columns.forEach((column, idx) => {
        if (idx === 0) {
          column.width = 25;
        } else {
          column.width = 15;
        }
      });

      // Enable autofilter on both table headers
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headerRow1.length }
      };

      // Send Excel file
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      
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
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
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
