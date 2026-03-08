# Horaire 112

Application web Next.js pour gerer le planning mensuel d'un service d'ambulance 112 belge.

## Stack
- Next.js 16 + TypeScript
- Prisma ORM
- PostgreSQL
- Tailwind CSS
- Auth.js (`next-auth`) pour l'authentification manager
- Playwright pour les tests UI

## Perimetre V1
- gestion des volontaires
- encodage rapide des disponibilites
- edition manuelle du planning mensuel
- visualisation immediate des creneaux a couvrir
- publication d'un horaire en lecture seule
- export PDF
- authentification manager via Google OAuth

Le serveur MCP reste hors scope pour le deploiement web actuel.

## Demarrage local
1. Installer les dependances:
   ```bash
   npm install
   ```
2. Copier l'environnement:
   ```bash
   cp .env.example .env
   ```
3. Demarrer PostgreSQL local:
   ```bash
   npm run db:up
   ```
4. Appliquer les migrations:
   ```bash
   npx prisma migrate deploy
   ```
5. Lancer l'application:
   ```bash
   npm run dev
   ```
6. Ouvrir:
   - `http://localhost:3000/manager`

## Variables d'environnement minimales
```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/horaire112?schema=public"
DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:55432/horaire112?schema=public"
AUTH_SECRET="une-cle-longue-et-secrete"
NEXTAUTH_URL="http://localhost:3000"
MANAGER_ALLOWED_EMAILS="toi@gmail.com"
AUTH_GOOGLE_ID="..."
AUTH_GOOGLE_SECRET="..."
ALLOW_OPEN_MANAGER_ACCESS="false"
```

## Managers autorises
Deux options:
- `MANAGER_ALLOWED_EMAILS` pour une allowlist rapide par emails exacts
- la table `manager_access` pour une gestion durable avec role

Commande utile:
```bash
npm run manager:upsert -- --email responsable@example.com --name "Responsable" --role PLANNER
```

## Commandes utiles
```bash
npm run db:up
npm run db:down
npm run db:logs
npm run lint
npm run build
npm run test:auth
npm run test:e2e
npx prisma migrate deploy
```

## CI et deploiement
Strategie retenue:
- **GitHub Actions pour la CI uniquement**
- **Vercel pour le deploiement**
- **Neon pour PostgreSQL**
- **migrations Prisma manuelles quand le schema change**

Documentation detaillee:
- [Deployment guide](docs/deployment.md)

## Verification locale
```bash
npm run lint
npm run build
npm run test:auth
```
