const { parentPort, workerData } = require('worker_threads');
const path = require('path');

// Parse qualité acte data
function parseQualiteActe(qualiteActe) {
  if (typeof qualiteActe === 'string') {
    try {
      qualiteActe = JSON.parse(qualiteActe);
    } catch (e) {
      console.log('[WORKER DEBUG] Failed to parse qualite_acte string:', e.message);
      return { doublons: 0, baseline: 0 };
    }
  }

  let doublons = 0;
  let baseline = 0;

  if (qualiteActe && typeof qualiteActe === 'object') {
    // Extract doublon count from array of objects
    if (qualiteActe.doublon && Array.isArray(qualiteActe.doublon)) {
      console.log('[WORKER DEBUG] Found doublon array with', qualiteActe.doublon.length, 'items');
      doublons = qualiteActe.doublon.reduce((total, item) => {
        const count = item.images ? item.images.length : 0;
        console.log('[WORKER DEBUG] Doublon item has', count, 'images');
        return total + count;
      }, 0);
    }
    
    // Extract baseline count from array of objects
    if (qualiteActe.baseline && Array.isArray(qualiteActe.baseline)) {
      console.log('[WORKER DEBUG] Found baseline array with', qualiteActe.baseline.length, 'items');
      baseline = qualiteActe.baseline.reduce((total, item) => {
        const count = item.images ? item.images.length : 0;
        console.log('[WORKER DEBUG] Baseline item has', count, 'images');
        return total + count;
      }, 0);
    }
  }

  console.log('[WORKER DEBUG] parseQualiteActe returning:', { doublons, baseline });
  return { doublons, baseline };
}

// Process the JSON file data
function processFileData(jsonContent, entryName, sourceFile) {
  try {
    const jsonData = JSON.parse(jsonContent);
    
    // Handle single object or array of objects
    const dataArray = Array.isArray(jsonData) ? jsonData : [jsonData];
    const results = [];
    
    for (const item of dataArray) {
      // Extract arborescence from file path
      const pathParts = entryName.split('/');
      pathParts.pop(); // Remove filename
      const arborescence = pathParts.join('/');
      
      // Parse quality data if present
      let doublons = 0;
      let baseline = 0;
      if (item.qualite_acte) {
        console.log(`[WORKER DEBUG] Processing qualite_acte for ${item.Num_lot}:`, JSON.stringify(item.qualite_acte).substring(0, 200));
        const qualityData = parseQualiteActe(item.qualite_acte);
        console.log(`[WORKER DEBUG] Extracted doublons=${qualityData.doublons}, baseline=${qualityData.baseline}`);
        doublons = qualityData.doublons;
        baseline = qualityData.baseline;
      } else {
        console.log(`[WORKER DEBUG] No qualite_acte found for ${item.Num_lot}`);
      }
      
      // Extract Num_lot - use filename as fallback if missing
      let numLot = item.Num_lot || item.num_lot || item.numero_lot;
      
      // If still null/undefined, try to extract from filename
      if (!numLot || numLot === 'null' || numLot === 'undefined') {
        const filename = path.basename(entryName, '.json');
        // Try to parse filename as number
        numLot = parseInt(filename) || null;
      }
      
      // Parse as integer
      const numLotInt = parseInt(numLot);
      
      // Final validation - must be a valid integer (allow 0)
      if (isNaN(numLotInt) || numLotInt === null || numLotInt === undefined) {
        console.warn(`[WORKER] ❌ Skipping entry in ${entryName}: invalid Num_lot (not a number): ${numLot}`);
        continue;
      }
      
      results.push({
        Num_lot: numLotInt,
        arborescence: item.arborescence || arborescence || null,
        login_controleur: item.login_controleur || item.controleur || 'agent de controle',
        login_scan: item.login_scan || item.agent_scan || 'agent de scan',
        date_debut: item.date_debut ? new Date(item.date_debut) : null,
        date_fin: item.date_fin ? new Date(item.date_fin) : null,
        nb_actes_traites: parseInt(item.nb_actes_traites) || 0,
        nb_actes_rejets: parseInt(item.nb_actes_rejets) || 0,
        tentative: parseInt(item.tentative) || 0,
        doublons: doublons,
        baseline: baseline,
        source_file: sourceFile
      });
    }
    
    return { success: true, data: results, entryName };
  } catch (error) {
    return { 
      success: false, 
      error: error.message, 
      entryName 
    };
  }
}

// Main worker execution
if (parentPort) {
  const { jsonContent, entryName, sourceFile } = workerData;
  
  const result = processFileData(jsonContent, entryName, sourceFile);
  
  parentPort.postMessage(result);
}
