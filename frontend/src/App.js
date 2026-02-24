import React from 'react';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Gestion Lots Dashboard</h1>
      </header>
      
      <main className="App-main">
        {/* TODO: Add components:
            - FileUpload component (drag & drop + button)
            - Dashboard component (statistics)
            - Controllers table
            - Lots table with filters
        */}
        <div className="placeholder">
          <h2>Upload Zone</h2>
          <p>Component for ZIP file upload will go here</p>
        </div>
        
        <div className="placeholder">
          <h2>Dashboard</h2>
          <p>Statistics and charts will go here</p>
        </div>
      </main>
    </div>
  );
}

export default App;
