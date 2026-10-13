import { config } from 'dotenv';

// Charge le .env du projet : les tests n'exécutent aucune requête base de
// données, mais les modules importés (orchestrateur) ouvrent un pool MySQL.
config();
