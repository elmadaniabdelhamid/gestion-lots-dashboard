import React, { useState, useEffect } from 'react';
import './App.css';

// Global Chart declaration for ESLint
/* global ApexCharts */

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [jsonData, setJsonData] = useState([]);
  const [filterTerm, setFilterTerm] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const initCharts = () => {
    console.log('Initializing ApexCharts...');
    
    try {
      // Line Chart - Progression des Lots
      const lineChart = {
        chart: {
          height: 300,
          type: 'line',
          zoom: {
            enabled: false
          },
          toolbar: {
            show: false
          }
        },
        dataLabels: {
          enabled: false
        },
        stroke: {
          curve: 'smooth',
          width: 3
        },
        series: [{
          name: "Lots",
          data: jsonData.map((item, index) => ({
            x: `Lot ${index + 1}`,
            y: item.nb_actes_traites || 0
          })).slice(0, 10)
        }],
        title: {
          text: 'Progression des Lots',
          align: 'left',
          style: {
            fontSize: '16px',
            fontWeight: 600,
            color: '#333'
          }
        },
        grid: {
          row: {
            colors: ['#f3f3f3', 'transparent'],
            opacity: 0.5
          },
        },
        xaxis: {
          categories: jsonData.slice(0, 10).map((item, index) => `Lot ${index + 1}`),
        },
        colors: ['#667eea'],
        tooltip: {
          y: {
            formatter: function (val) {
              return val + " actes"
            }
          }
        }
      };
      new ApexCharts(document.querySelector("#line-chart"), lineChart).render();

      // Bar Chart - Actes traités par contrôleur
      const controllerChart = {
        chart: {
          height: 300,
          type: 'bar',
          toolbar: {
            show: false
          }
        },
        plotOptions: {
          bar: {
            horizontal: false,
            columnWidth: '60%',
            borderRadius: 8
          }
        },
        dataLabels: {
          enabled: false
        },
        series: [{
          name: 'Actes Traités',
          data: Object.entries(
            jsonData.reduce((acc, item) => {
              const controleur = item.login_controleur === 0 || item.login_controleur === '0' ? 
                'agent_controleur' : 
                (item.login_controleur || 'Non spécifié');
              const actesTraites = parseInt(item.nb_actes_traites);
              if (!isNaN(actesTraites) && actesTraites > 0) {
                acc[controleur] = (acc[controleur] || 0) + actesTraites;
              }
              return acc;
            }, {})
          ).map(([controleur, total]) => ({
            x: controleur,
            y: total
          })).sort((a, b) => b.y - a.y).slice(0, 10)
        }],
        title: {
          text: 'Actes Traités par Contrôleur',
          align: 'left',
          style: {
            fontSize: '16px',
            fontWeight: 600,
            color: '#333'
          }
        },
        xaxis: {
          categories: Object.entries(
            jsonData.reduce((acc, item) => {
              const controleur = item.login_controleur === 0 || item.login_controleur === '0' ? 
                'agent_controleur' : 
                (item.login_controleur || 'Non spécifié');
              const actesTraites = parseInt(item.nb_actes_traites);
              if (!isNaN(actesTraites) && actesTraites > 0) {
                acc[controleur] = (acc[controleur] || 0) + actesTraites;
              }
              return acc;
            }, {})
          ).map(([controleur]) => controleur)
            .sort((a, b) => {
              const totalA = jsonData.reduce((acc, item) => {
                const actes = parseInt(item.nb_actes_traites);
                const controleurA = item.login_controleur === 0 || item.login_controleur === '0' ? 
                  'agent_controleur' : 
                  (item.login_controleur || 'Non spécifié');
                return (controleurA === a && !isNaN(actes) && actes > 0) ? acc + actes : acc;
              }, 0);
              const totalB = jsonData.reduce((acc, item) => {
                const actes = parseInt(item.nb_actes_traites);
                const controleurB = item.login_controleur === 0 || item.login_controleur === '0' ? 
                  'agent_controleur' : 
                  (item.login_controleur || 'Non spécifié');
                return (controleurB === b && !isNaN(actes) && actes > 0) ? acc + actes : acc;
              }, 0);
              return totalB - totalA;
            }).slice(0, 10)
        },
        yaxis: {
          title: {
            text: 'Nombre d\'Actes'
          }
        },
        colors: ['#667eea'],
        tooltip: {
          y: {
            formatter: function (val) {
              return val + " actes"
            }
          }
        }
      };
      new ApexCharts(document.querySelector("#donut-chart"), controllerChart).render();
      
      console.log('ApexCharts initialized successfully');
    } catch (error) {
      console.error('Error initializing ApexCharts:', error);
    }
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
        setSelectedFile(file);
        setUploadStatus('');
      } else {
        setUploadStatus('Veuillez sélectionner un fichier ZIP valide');
        setSelectedFile(null);
      }
    }
  };

  const handleBackToUpload = () => {
    setShowDashboard(false);
    setJsonData([]);
    setUploadStatus('');
    setCurrentPage(1);
  };

  const handleFilterToggle = () => {
    setShowFilterModal(!showFilterModal);
  };

  const handleFilterChange = (e) => {
    setFilterTerm(e.target.value);
    setCurrentPage(1); // Reset to first page when filter changes
  };

  const handleExport = async (format = 'xlsx') => {
    try {
      setIsLoading(true);
      
      const response = await fetch(`http://localhost:5000/api/export/report?format=${format}`);
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const extension = format === 'xlsx' || format === 'excel' ? 'xlsx' : (format === 'csv' ? 'csv' : 'json');
        a.download = `rapport-gestion-lots-${Date.now()}.${extension}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        setUploadStatus('Rapport exporté avec succès!');
        setTimeout(() => setUploadStatus(''), 3000);
      } else {
        setUploadStatus('Erreur lors de l\'export du rapport');
      }
    } catch (error) {
      console.error('Error exporting report:', error);
      setUploadStatus('Erreur de connexion au serveur');
    } finally {
      setIsLoading(false);
    }
  };

  const getFilteredData = () => {
    if (!filterTerm) return jsonData;
    
    return jsonData.filter(item => 
      (item.Num_lot && item.Num_lot.toString().toLowerCase().includes(filterTerm.toLowerCase())) ||
      (item.arborescence && item.arborescence.toLowerCase().includes(filterTerm.toLowerCase())) ||
      (item.login_controleur && item.login_controleur.toString().toLowerCase().includes(filterTerm.toLowerCase())) ||
      (item.login_scan && item.login_scan.toString().toLowerCase().includes(filterTerm.toLowerCase()))
    );
  };

  const getPaginatedData = () => {
    const filteredData = getFilteredData();
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredData.slice(startIndex, endIndex);
  };

  const getTotalPages = () => {
    return Math.ceil(getFilteredData().length / itemsPerPage);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < getTotalPages()) {
      setCurrentPage(currentPage + 1);
    }
  };

  // Initialize ApexCharts when dashboard is shown
  useEffect(() => {
    if (showDashboard && jsonData.length > 0) {
      setTimeout(() => {
        initCharts();
      }, 500);
    }
  }, [showDashboard, jsonData]);

  const handleUpload = async () => {
    if (!selectedFile) {
      setUploadStatus('Veuillez d\'abord sélectionner un fichier');
      return;
    }

    const formData = new FormData();
    formData.append('zipFile', selectedFile);

    try {
      setIsLoading(true);
      setUploadStatus('Upload en cours...');
      const response = await fetch('http://localhost:5000/api/import/zip', {
        method: 'POST',
        body: formData
      });
      
      if (response.ok) {
        setUploadStatus('Fichier uploadé avec succès!');
        setSelectedFile(null);
        document.getElementById('fileInput').value = '';
        
        // Récupérer les données JSON depuis le backend
        const dataResponse = await fetch('http://localhost:5000/api/controle');
        if (dataResponse.ok) {
          const data = await dataResponse.json();
          console.log('Données reçues:', data);
          console.log('Exemple de données:', data[0]);
          console.log('login_scan valeurs:', data.map(item => item.login_scan));
          console.log('login_controleur valeurs:', data.map(item => item.login_controleur));
          console.log('Somme actes traités:', data.reduce((acc, item) => {
            const actes = parseInt(item.nb_actes_traites);
            return !isNaN(actes) ? acc + actes : acc;
          }, 0));
          console.log('Somme actes rejets:', data.reduce((acc, item) => {
            const actes = parseInt(item.nb_actes_rejets);
            return !isNaN(actes) ? acc + actes : acc;
          }, 0));
          setJsonData(data);
          setShowDashboard(true);
        } else {
          setUploadStatus('Erreur lors de la récupération des données');
        }
      } else {
        setUploadStatus('Erreur lors de l\'upload');
      }
    } catch (error) {
      setUploadStatus('Erreur de connexion au serveur');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="App">
      {isLoading && (
        <div className="loader-overlay">
          <div className="cube-wrapper">
            <div className="cube-folding">
              <span className="leaf1"></span>
              <span className="leaf2"></span>
              <span className="leaf3"></span>
              <span className="leaf4"></span>
            </div>
            <span className="loading">Extraction en cours...</span>
          </div>
        </div>
      )}
      
      <header className="App-header">
        <h1>Gestion Lots Dashboard</h1>
      </header>
      
      <main className="App-main">
        {!showDashboard ? (
          <div className="upload-zone">
            <h2>Importation de Fichiers</h2>
            <p>Téléchargez un fichier ZIP contenant les données JSON</p>
            
            <div className="upload-container">
              <div className="file-input-wrapper">
                <input
                  type="file"
                  id="fileInput"
                  onChange={handleFileSelect}
                  accept=".zip"
                />
                <label htmlFor="fileInput" className="file-input-label">
                  <i className="fa fa-cloud-upload"></i>
                  {selectedFile ? selectedFile.name : 'Choisir un fichier ZIP'}
                </label>
              </div>
              
              <button 
                onClick={handleUpload}
                className="upload-button"
                disabled={!selectedFile || isLoading}
              >
                <i className="fa fa-upload"></i> Importer
              </button>
              
              {uploadStatus && (
                <div className={`upload-status ${uploadStatus.includes('succès') ? 'success' : uploadStatus.includes('Erreur') ? 'error' : 'info'}`}>
                  <i className={`fa ${uploadStatus.includes('succès') ? 'fa-check-circle' : uploadStatus.includes('Erreur') ? 'fa-exclamation-circle' : 'fa-info-circle'}`}></i>
                  {uploadStatus}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="dashboard-container">
            <div className="dashboard-header">
              <button className="back-button" onClick={handleBackToUpload}>
                <i className="fa fa-arrow-left"></i> Retour à l'upload
              </button>
              <h1 className="dashboard-title">Tableau de Bord - Gestion des Lots</h1>
            </div>
            
            <div className="dashboard-grid">
              {/* Cartes de statistiques */}
              <div className="stats-grid">
                <div className="stat-card primary">
                  <div className="stat-icon">
                    <i className="fa fa-folder"></i>
                  </div>
                  <div className="stat-content">
                    <h3>Total des Lots</h3>
                    <p className="stat-number">{jsonData.length}</p>
                    <span className="stat-label">Fichiers traités</span>
                  </div>
                </div>
                
                <div className="stat-card success">
                  <div className="stat-icon">
                    <i className="fa fa-check-circle"></i>
                  </div>
                  <div className="stat-content">
                    <h3>Actes Traités</h3>
                    <p className="stat-number">{jsonData.reduce((acc, item) => {
  const actes = parseInt(item.nb_actes_traites);
  return !isNaN(actes) ? acc + actes : acc;
}, 0).toLocaleString()}</p>
                    <span className="stat-label">Succès</span>
                  </div>
                </div>
                
                <div className="stat-card danger">
                  <div className="stat-icon">
                    <i className="fa fa-exclamation-triangle"></i>
                  </div>
                  <div className="stat-content">
                    <h3>Actes Rejetés</h3>
                    <p className="stat-number">{jsonData.reduce((acc, item) => {
  const actes = parseInt(item.nb_actes_rejets);
  return !isNaN(actes) ? acc + actes : acc;
}, 0).toLocaleString()}</p>
                    <span className="stat-label">Erreurs</span>
                  </div>
                </div>

                <div className="stat-card warning">
                  <div className="stat-icon">
                    <i className="fa fa-copy"></i>
                  </div>
                  <div className="stat-content">
                    <h3>Doublons</h3>
                    <p className="stat-number">{jsonData.reduce((acc, item) => acc + (item.doublons || 0), 0).toLocaleString()}</p>
                    <span className="stat-label">Fichiers dupliqués</span>
                  </div>
                </div>

                <div className="stat-card secondary">
                  <div className="stat-icon">
                    <i className="fa fa-ruler"></i>
                  </div>
                  <div className="stat-content">
                    <h3>Baseline</h3>
                    <p className="stat-number">{jsonData.reduce((acc, item) => acc + (item.baseline || 0), 0).toLocaleString()}</p>
                    <span className="stat-label">Références</span>
                  </div>
                </div>

                <div className="stat-card tertiary">
                  <div className="stat-icon">
                    <i className="fa fa-users"></i>
                  </div>
                  <div className="stat-content">
                    <h3>Contrôleurs</h3>
                    <p className="stat-number">{new Set(jsonData.map(item => item.login_controleur).filter(Boolean)).size}</p>
                    <span className="stat-label">Opérateurs actifs</span>
                  </div>
                </div>
              </div>

              {/* Graphiques */}
              <div className="charts-grid">
                <div className="chart-card">
                  <div className="chart-header">
                    <h3>Progression des Lots</h3>
                    <div className="chart-actions">
                      <button className="chart-action-btn">
                        <i className="fa fa-ellipsis-h"></i>
                      </button>
                    </div>
                  </div>
                  <div className="chart-container">
                    <div id="line-chart"></div>
                  </div>
                </div>
                
                <div className="chart-card">
                  <div className="chart-header">
                    <h3>Actes Traités par Contrôleur</h3>
                    <div className="chart-actions">
                      <button className="chart-action-btn">
                        <i className="fa fa-ellipsis-h"></i>
                      </button>
                    </div>
                  </div>
                  <div className="chart-container">
                    <div id="donut-chart"></div>
                  </div>
                </div>
              </div>

              {/* Tableau des lots récents */}
              <div className="table-card">
                <div className="table-header">
                  <h3>Lots Récents</h3>
                  <div className="table-actions">
                    <button className="table-action-btn active" onClick={handleFilterToggle}>
                      <i className="fa fa-filter"></i>
                    </button>
                    <button className="table-action-btn" onClick={() => handleExport('xlsx')} title="Exporter le rapport en Excel">
                      <i className="fa fa-download"></i>
                    </button>
                  </div>
                </div>
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Numéro Lot</th>
                        <th>Arborescence</th>
                        <th>Contrôleur</th>
                        <th>Agent Scan</th>
                        <th>Date Début</th>
                        <th>Date Fin</th>
                        <th>Actes Traités</th>
                        <th>Actes Rejetés</th>
                        <th>Doublons</th>
                        <th>Baseline</th>
                        <th>Tentatives</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getPaginatedData().map((item, index) => (
                        <tr key={index}>
                          <td>{item.Num_lot || 'N/A'}</td>
                          <td>{item.arborescence || 'N/A'}</td>
                          <td>
                            {item.login_controleur === 0 || item.login_controleur === '0' ? 
                              'agent_controleur ' : 
                              item.login_controleur || 'N/A'
                            }
                          </td>
                          <td>
                            {item.login_scan === 0 || item.login_scan === '0' ? 
                              'agent_scan ' : 
                              item.login_scan || 'N/A'
                            }
                          </td>
                          <td>
                            {item.date_debut ? 
                              new Date(item.date_debut).toLocaleDateString('fr-FR') : 
                              'N/A'
                            }
                          </td>
                          <td>
                            {item.date_fin ? 
                              new Date(item.date_fin).toLocaleDateString('fr-FR') : 
                              'N/A'
                            }
                          </td>
                          <td>{item.nb_actes_traites || 0}</td>
                          <td>{item.nb_actes_rejets || 0}</td>
                          <td>{item.doublons || 0}</td>
                          <td>{item.baseline || 0}</td>
                          <td>{item.tentative || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* Pagination Controls */}
                {getTotalPages() > 1 && (
                  <div className="pagination-container">
                    <div className="pagination-info">
                      <span>
                        Affichage {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, getFilteredData().length)} 
                        {' '}sur {getFilteredData().length} résultats
                      </span>
                    </div>
                    <div className="pagination-controls">
                      <button 
                        className="pagination-btn prev-btn" 
                        onClick={handlePreviousPage}
                        disabled={currentPage === 1}
                      >
                        <i className="fa fa-chevron-left"></i>
                        Précédent
                      </button>
                      
                      <div className="pagination-numbers">
                        {Array.from({ length: getTotalPages() }, (_, i) => i + 1).map(page => (
                          <button
                            key={page}
                            className={`pagination-number ${currentPage === page ? 'active' : ''}`}
                            onClick={() => handlePageChange(page)}
                          >
                            {page}
                          </button>
                        ))}
                      </div>
                      
                      <button 
                        className="pagination-btn next-btn" 
                        onClick={handleNextPage}
                        disabled={currentPage === getTotalPages()}
                      >
                        Suivant
                        <i className="fa fa-chevron-right"></i>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Filter Modal */}
              {showFilterModal && (
                <div className="filter-modal-overlay">
                  <div className="filter-modal">
                    <div className="filter-modal-header">
                      <h4>Filtrer les Lots</h4>
                      <button className="filter-modal-close" onClick={handleFilterToggle}>
                        <i className="fa fa-times"></i>
                      </button>
                    </div>
                    <div className="filter-modal-content">
                      <div className="filter-input-group">
                        <label htmlFor="filter-input">Rechercher :</label>
                        <input
                          id="filter-input"
                          type="text"
                          value={filterTerm}
                          onChange={handleFilterChange}
                          placeholder="Numéro de lot, arborescence, contrôleur, agent..."
                          className="filter-input"
                        />
                      </div>
                      <div className="filter-info">
                        <p>{getFilteredData().length} résultat(s) trouvé(s)</p>
                      </div>
                    </div>
                    <div className="filter-modal-footer">
                      <button className="filter-btn-clear" onClick={() => setFilterTerm('')}>
                        <i className="fa fa-clear"></i> Effacer
                      </button>
                      <button className="filter-btn-apply" onClick={handleFilterToggle}>
                        <i className="fa fa-check"></i> Appliquer
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
