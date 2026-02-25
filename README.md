# Gestion Lots Dashboard

Une application web pour gérer et visualiser les statistiques de traitement de documents provenant des opérations de contrôle par lots.

## 🏗️ Architecture

- **Frontend**: React.js
- **Backend**: Node.js + Express
- **Base de données**: PostgreSQL
- **Conteneurisation**: Docker + Docker Compose

## 📁 Structure du Projet

```
gestion-lots-dashboard/
├── backend/              # Serveur API Node.js
│   ├── database/         # Schéma de la base de données
│   ├── uploads/          # Fichiers ZIP téléchargés
│   ├── server.js         # Fichier serveur principal
│   ├── package.json
│   └── Dockerfile
├── frontend/             # Application React
│   ├── public/
│   ├── src/
│   ├── package.json
│   └── Dockerfile
└── docker-compose.yml    # Orchestration Docker
```

## 🚀 Démarrage

### Prérequis

- Node.js 18+
- Docker & Docker Compose
- PostgreSQL (si exécution sans Docker)

### Installation

1. Cloner le dépôt :
```bash
git clone https://github.com/elmadaniabdelhamid/gestion-lots-dashboard.git
cd gestion-lots-dashboard
```
### Développement Local (Recommandé)

**Backend :**
```bash
cd backend
npm install
npm run dev
```

**Frontend :**
```bash
cd frontend
npm install
npm start
```

`

L'application sera disponible à :
- Frontend : http://localhost:3000
- API Backend : http://localhost:5000
- Base de données : localhost:5432

### Configuration Manuelle (Sans Docker)

**Backend :**
```bash
cd backend
npm install
npm run dev
```

**Frontend :**
```bash
cd frontend
npm install
npm start
```

**Base de données :**
```bash
psql -U postgres
CREATE DATABASE gestion_lots;
\i backend/database/schema.sql
```

## 📊 Fonctionnalités



## 🗄️ Schéma de Base de Données



## 📝 Structure JSON

L'application attend des fichiers JSON avec la structure suivante :
```json
{
  "Num_lot": "11953001065326",
  "login_controleur": "MOHAMED",
  "nb_actes_traites": 500,
  "nb_actes_rejets": 20,
  "date_debut": "2026-01-31 17:26:23",
  "date_fin": "2026-01-31 20:12:41",
  ...
}
```


## 📄 Licence

Ce projet est privé et confidentiel.