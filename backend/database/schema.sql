-- Create the controle table for managing lots
CREATE TABLE IF NOT EXISTS controle (
    "Num_lot" BIGINT PRIMARY KEY,
    arborescence TEXT,
    login_controleur VARCHAR(255) DEFAULT 'agent de controle',
    login_scan VARCHAR(255) DEFAULT 'agent de scan',
    date_debut TIMESTAMP,
    date_fin TIMESTAMP,
    nb_actes_traites INTEGER DEFAULT 0,
    nb_actes_rejets INTEGER DEFAULT 0,
    tentative INTEGER DEFAULT 0,
    doublons INTEGER DEFAULT 0,
    baseline INTEGER DEFAULT 0,
    source_file VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_controle_arborescence ON controle(arborescence);
CREATE INDEX IF NOT EXISTS idx_controle_controleur ON controle(login_controleur);
CREATE INDEX IF NOT EXISTS idx_controle_scan ON controle(login_scan);
CREATE INDEX IF NOT EXISTS idx_controle_dates ON controle(date_debut, date_fin);
CREATE INDEX IF NOT EXISTS idx_controle_source_file ON controle(source_file);

-- Insert a sample record (optional, for testing)
-- INSERT INTO controle ("Num_lot", arborescence, login_controleur, login_scan, nb_actes_traites, nb_actes_rejets)
-- VALUES ('TEST001', 'test/sample', 'admin', 'scanner1', 100, 5)
-- ON CONFLICT ("Num_lot") DO NOTHING;
