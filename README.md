# ⚽ Kicker Tournament

Application web pour gérer des tournois de kicker (baby-foot). Conçue pour être utilisée sur mobile.

## Fonctionnalités

- 🏆 Création de tournois (Round Robin ou Élimination directe)
- 👥 Gestion des joueurs
- ⚽ Saisie des scores en temps réel
- 📊 Classement automatique (points, différence de buts)
- 📱 Interface mobile-first
- 🎮 Données de démo en un clic

## Stack

- **Backend** : Node.js + Express + SQLite (better-sqlite3)
- **Frontend** : HTML/CSS/JS vanilla, mobile-first
- **Langue** : Interface en français 🇧🇪

## Installation

```bash
npm install
npm start
```

L'application sera disponible sur `http://localhost:3000`

## API

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| POST | /api/tournaments | Créer un tournoi |
| GET | /api/tournaments | Lister les tournois |
| GET | /api/tournaments/:id | Détails d'un tournoi |
| POST | /api/tournaments/:id/players | Ajouter un joueur |
| DELETE | /api/tournaments/:id/players/:pid | Supprimer un joueur |
| POST | /api/tournaments/:id/generate | Générer les matchs |
| PUT | /api/matches/:id/score | Enregistrer un score |
| GET | /api/tournaments/:id/standings | Classement |
| POST | /api/seed | Créer un tournoi de démo |

---

Créé par Soph.IA lors d'un Lunch & Learn NRB 🚀
