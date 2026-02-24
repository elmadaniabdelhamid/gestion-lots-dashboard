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

2. Configurer les variables d'environnement :
```bash
cp backend/.env.example backend/.env
# Modifier backend/.env avec votre configuration
```

3. Lancer avec Docker :
```bash
docker-compose up --build
```

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

- ✅ Téléchargement de fichiers ZIP contenant des métadonnées JSON
- ✅ Extraction et analyse des données JSON depuis l'archive
- ✅ Stockage des informations de lots et contrôleurs dans PostgreSQL
- ✅ Tableau de bord avec statistiques :
  - Total d'images traitées
  - Images par contrôleur
  - Statistiques journalières/mensuelles
  - Taux de rejet et raisons

## 🗄️ Schéma de Base de Données

### Table Controller
- Stocke les informations uniques des contrôleurs
- Suit les performances des agents

### Table Lot
- Informations de traitement par lot
- Liée aux contrôleurs
- Contient les dates de traitement, statistiques et résultats des contrôles qualité

## 🔧 Points de Terminaison API

- `GET /api/health` - Vérification de santé
- `POST /api/upload` - Télécharger un fichier ZIP
- `POST /api/lots` - Traiter et stocker les données de lots
- `GET /api/controllers` - Obtenir tous les contrôleurs
- `GET /api/lots` - Obtenir les lots avec filtres
- `GET /api/stats` - Obtenir les statistiques du tableau de bord

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

## 👥 Équipe

- [Abdelhamid El Madani](https://github.com/elmadaniabdelhamid)

## 📄 Licence

Ce projet est privé et confidentiel.