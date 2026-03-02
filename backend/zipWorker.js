const { parentPort, workerData } = require('worker_threads');
const path = require('path');

// Parse qualité acte data
function parseQualiteActe(qualiteActe) {
  if (typeof qualiteActe === 'string') {
    try {
      qualiteActe = JSON.parse(qualiteActe);
    } catch (e) {
      return { doublons: 0, baseline: 0 };
    }
  }

  let doublons = 0;
  let baseline = 0;

  if (qualiteActe && typeof qualiteActe === 'object') {
    if (qualiteActe.doublons !== undefined) {
      doublons = parseInt(qualiteActe.doublons) || 0;
    }
    if (qualiteActe.baseline !== undefined) {
      baseline = parseInt(qualiteActe.baseline) || 0;
    }
  }

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
        const qualityData = parseQualiteActe(item.qualite_acte);
        doublons = qualityData.doublons;
        baseline = qualityData.baseline;
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
        doublons: item.doublons || doublons || 0,
        baseline: item.baseline || baseline || 0,
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
