# GHOSTROAR REPUTATION

Application de gestion de l’e-réputation reproduisant les interfaces françaises fournies : tableau de bord, profil, sources, mentions, analyse, alertes, War Room, contenus, relations médias, rapports, protection de l’identité, paramètres et offres Starter / Pro / Premium.

## Environnement

Le runtime utilise **Next.js App Router, TypeScript, React, CSS et MySQL avec Drizzle ORM**, et non Laravel. Le backend fonctionne dans les route handlers Next.js. Aucun service PHP externe n’est nécessaire.

- `DATABASE_URL` : connexion MySQL fournie dans `.env` (base `ereputation1` en environnement local).
- `COOKIE_SECURE` : les cookies sont sécurisés par défaut en production. Utilisez `false` uniquement pour un environnement local HTTP si nécessaire.
- Connexion Facebook : copiez les variables Facebook de `.env.example` vers votre `.env`, puis renseignez `FACEBOOK_APP_ID` et `FACEBOOK_APP_SECRET` depuis Meta for Developers. Enregistrez exactement la valeur de `FACEBOOK_REDIRECT_URI` (par défaut `http://localhost:3000/api/integrations/facebook/callback`) comme URI de redirection OAuth valide dans l’application Meta. La collecte de publications demande `pages_show_list` et `pages_read_engagement`. Activez cette permission dans Meta for Developers > App Review > Permissions and Features ; en mode développement, l’utilisateur qui se connecte doit aussi avoir un rôle dans l’application. Meta peut demander une App Review ou Page Public Content Access selon l’accès demandé. Le callback vérifie maintenant que la permission a réellement été accordée et ne marque pas la Page comme connectée si elle manque. Une fois l’accès Meta accordé, reconnectez la Page pour émettre un nouveau jeton. `auth_type=rerequest` invite Meta à redemander une permission précédemment refusée. Après toute modification de `.env`, redémarrez `npm run dev`. `FACEBOOK_GRAPH_API_VERSION` est facultative (valeur par défaut `v23.0`).
- Node.js 22 ou version compatible avec Next.js 16.

## Démarrage

1. Installer les dépendances avec `npm install`.
2. Configurer `DATABASE_URL`.
3. Appliquer le schéma avec `npx drizzle-kit push`.
4. Développement : `npm run dev`.
5. Production : `npm run build`, puis le runtime de déploiement lance l’application.

La page d’accueil crée automatiquement un espace de démonstration persistant. Le menu du compte permet d’ouvrir la connexion et de créer un espace personnel isolé. Aucun mot de passe de démonstration partagé n’est exposé.

## Fonctions

- Authentification par email / mot de passe haché avec scrypt, sessions serveur à jetons hachés, cookies HTTP-only, déconnexion et révocation des autres sessions.
- Double authentification TOTP réelle pour les comptes personnels, configuration par clé dans une application compatible, vérification à la connexion et désactivation par code.
- Connexion OAuth à Facebook pour lister les Pages que le compte peut administrer et choisir la Page reliée à l’espace. Depuis l’écran Mentions, la collecte examine le fil de la Page et ses commentaires, filtre les textes par mots-clés actifs, puis enregistre les nouvelles correspondances sans doublons. Elle se relance au chargement et toutes les 15 minutes tant que l’écran Mentions reste ouvert ; elle n’est pas un ordonnanceur serveur et ne parcourt pas toutes les publications publiques Facebook. La publication concerne les Pages Facebook, pas les profils personnels ; elle nécessite notamment `pages_manage_posts`, qui n’est pas sollicité tant que la publication Facebook n’est pas implémentée.
- Isolation des données par compte et contrôles d’origine sur les mutations.
- CRUD complet pour les sources, mentions, alertes, règles, publications, contacts, rapports, crises, rendez-vous, campagnes, menaces d’identité et moniteurs.
- Sauvegarde du compte et des préférences, photo de profil persistante dans MySQL, recherche globale, filtres, pagination, mises à jour optimistes et restauration en cas d’erreur.
- Résolution, signalement local et préparation des demandes de retrait pour les menaces d’identité.
- Choix de plan persistant avec confirmation explicite en mode démonstration.
- Exports CSV, rapports texte téléchargeables, calendrier éditorial, contenus programmés et brouillons.
- Messages préparés et enregistrés avant ouverture de la messagerie locale par lien mailto.
- Interfaces responsives, navigation mobile, focus clavier, fenêtres accessibles, états vides, chargement et retours d’erreur.

## Limites explicites de la démonstration

Les données sont réalistes et persistantes, mais les sources sociales ne sont pas reliées à des API de collecte externes. Le scan vérifie les moniteurs et menaces déjà enregistrés. L’analyse de réputation calcule des résultats à partir des sentiments et scores locaux ; elle n’appelle pas un modèle IA externe. Les demandes de retrait ne sont pas transmises automatiquement aux plateformes. Les états publiés / programmés sont gérés dans l’espace local ; la publication sur les réseaux nécessite un connecteur réel. La connexion Facebook permet d’autoriser et de sélectionner une Page ; la publication Facebook depuis l’éditeur n’est pas encore branchée. Les préférences de notifications sont enregistrées, mais aucun service d’envoi d’email ou push n’est configuré. Les changements de plan ne réalisent aucun paiement. Les interfaces de confirmation et les rapports précisent ces limites.

## Structure

- `src/app/` : pages, layout, styles et routes API.
- `src/components/views/` : écrans conformes aux références.
- `src/components/workspace-context.tsx` : données, synchronisation, notifications et mises à jour optimistes.
- `src/components/dialogs.tsx` : formulaires CRUD et fenêtres communes.
- `src/db/schema.ts` : utilisateurs, sessions et ressources persistantes typées.
- Les mots clés sont stockés dans `ghostroar_resources` (type `keywords`) avec leurs plateformes dans la base MySQL.
- `src/lib/auth.ts`, `src/lib/totp.ts` : authentification et codes TOTP.
- `src/lib/demo-data.ts` : jeu de données de démonstration.
- `public/` : polices et images locales.

## Vérification

- `npx next typegen`
- `npm exec tsc -- --noEmit --pretty false`
- `npm run build`
- `GET /api/health` vérifie MySQL.
- `npx playwright install --with-deps chromium`
- Serveur lancé : `node scripts/verify.mjs`.
- Captures et contrôle responsive uniquement : `node scripts/verify.mjs --visual`.
- URL de test personnalisée : variable `TEST_BASE_URL`.

Les tests couvrent toutes les pages desktop et mobile, les préférences persistantes, la protection d’identité, l’abonnement, les CRUD, les validations, les exports, l’isolation des comptes et la double authentification.

## Images

Le logo et le portrait de démonstration ont été générés pour cette reproduction. Les photographies éditoriales proviennent de Pexels : Werner Pfennig, Angela Roma et Ben Khatry. Toutes les ressources nécessaires au rendu sont enregistrées localement.
