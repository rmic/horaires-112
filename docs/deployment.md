# Deploiement Vercel + Neon

## Cible retenue
- UI Next.js deployee sur Vercel
- PostgreSQL heberge sur Neon
- authentification manager via Auth.js (`next-auth`) + Google OAuth
- CI sur GitHub Actions
- CD sur GitHub Actions + Vercel CLI
- migrations Prisma executees avant le deploiement Vercel

Le serveur MCP reste hors scope pour ce deploiement. Il pourra se brancher plus tard sur la meme base PostgreSQL et le meme mapping d'utilisateurs internes.

## Architecture
- `DATABASE_URL`: URL PostgreSQL de runtime
- `DIRECT_URL`: URL PostgreSQL directe pour Prisma CLI et migrations
- `AUTH_SECRET`: secret Auth.js pour signer les sessions
- `MANAGER_ALLOWED_EMAILS`: allowlist rapide par emails exacts
- `manager_access` en base: allowlist durable avec role associe

Strategie retenue:
- local: Docker Postgres sur `127.0.0.1:55432`
- staging: Vercel preview + base Neon dediee
- production: Vercel production + base Neon dediee

## 1. Lancer en local
1. Installer les dependances:
   ```bash
   npm install
   ```
2. Copier l'environnement local:
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

## 2. Configurer Neon
1. Creer un projet dans Neon.
2. Creer au minimum deux bases ou deux branches:
   - `production`
   - `staging`
3. Recuperer deux URL par environnement:
   - l'URL pooled/runtime pour `DATABASE_URL`
   - l'URL directe pour `DIRECT_URL`
4. Conserver les deux en `sslmode=require` si Neon les fournit ainsi.

Convention recommandee:
- `DATABASE_URL` = URL pooled fournie par Neon
- `DIRECT_URL` = URL directe fournie par Neon

Exemple de structure:
```bash
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/horaire112?sslmode=require"
DIRECT_URL="postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/horaire112?sslmode=require"
```

## 3. Configurer Google OAuth
1. Creer un client OAuth 2.0 de type `Web application` dans Google Cloud.
2. Ajouter les redirect URIs:
   - local: `http://localhost:3000/api/auth/callback/google`
   - staging: `https://staging.<ton-domaine>/api/auth/callback/google`
   - production: `https://<ton-domaine>/api/auth/callback/google`
3. Renseigner:
   ```bash
   AUTH_GOOGLE_ID="..."
   AUTH_GOOGLE_SECRET="..."
   ```
4. Renseigner aussi l'URL publique de l'application:
   ```bash
   NEXTAUTH_URL="https://<ton-domaine>"
   ```

### Microsoft OAuth (optionnel)
1. Creer une `App registration` dans Microsoft Entra.
2. Ajouter les redirect URIs:
   - local: `http://localhost:3000/api/auth/callback/azure-ad`
   - staging: `https://staging.<ton-domaine>/api/auth/callback/azure-ad`
   - production: `https://<ton-domaine>/api/auth/callback/azure-ad`
3. Renseigner:
   ```bash
   AUTH_MICROSOFT_ID="..."
   AUTH_MICROSOFT_SECRET="..."
   AUTH_MICROSOFT_TENANT_ID="common"
   ```
4. Si tu veux accepter aussi les comptes Outlook/Hotmail personnels, il faut choisir un type de comptes Microsoft qui les autorise et garder `AUTH_MICROSOFT_TENANT_ID="common"`.

## 4. Autoriser les managers
Deux options existent.

### Option A: allowlist par variable d'environnement
Pour demarrer vite:
```bash
MANAGER_ALLOWED_EMAILS="responsable1@example.com,responsable2@example.com"
```

### Option B: allowlist en base
Pour une gestion durable:
```bash
npm run manager:upsert -- --email responsable1@example.com --name "Responsable 1" --role PLANNER
npm run manager:upsert -- --email responsable2@example.com --name "Responsable 2" --role READ_ONLY
```

Regle importante:
- l'email doit correspondre exactement au compte Google utilise pour se connecter
- un compte Google non autorise est refuse meme si l'authentification Google reussit

## 5. Variables d'environnement a definir

### Local
```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/horaire112?schema=public"
DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:55432/horaire112?schema=public"
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/horaire112?schema=test_auth"
TEST_DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:55432/horaire112?schema=test_auth"
AUTH_SECRET="une-cle-longue-et-secrete"
NEXTAUTH_URL="http://localhost:3000"
MANAGER_ALLOWED_EMAILS="toi@gmail.com"
AUTH_GOOGLE_ID="..."
AUTH_GOOGLE_SECRET="..."
ALLOW_OPEN_MANAGER_ACCESS="false"
```

### Staging Vercel
```bash
DATABASE_URL="<Neon pooled staging>"
DIRECT_URL="<Neon direct staging>"
AUTH_SECRET="<secret staging>"
NEXTAUTH_URL="https://staging.<ton-domaine>"
MANAGER_ALLOWED_EMAILS="responsable@example.com"
AUTH_GOOGLE_ID="..."
AUTH_GOOGLE_SECRET="..."
ALLOW_OPEN_MANAGER_ACCESS="false"
```

### Production Vercel
```bash
DATABASE_URL="<Neon pooled production>"
DIRECT_URL="<Neon direct production>"
AUTH_SECRET="<secret production>"
NEXTAUTH_URL="https://<ton-domaine>"
MANAGER_ALLOWED_EMAILS="responsable@example.com"
AUTH_GOOGLE_ID="..."
AUTH_GOOGLE_SECRET="..."
ALLOW_OPEN_MANAGER_ACCESS="false"
```

Optionnel:
```bash
AUTH_MICROSOFT_ID="..."
AUTH_MICROSOFT_SECRET="..."
AUTH_MICROSOFT_TENANT_ID="common"
```

## 6. Connecter le repo a Vercel
1. Pousser le repo sur GitHub.
2. Dans Vercel, cliquer `Add New...` puis `Project`.
3. Importer le repository GitHub.
4. Laisser le preset `Next.js`.
5. Ajouter toutes les variables d'environnement Vercel pour `Preview` et `Production`.
6. Recuperer ensuite dans Vercel:
   - `Project ID`
   - `Team ID` ou `Personal Account ID`
7. Creer un token Vercel personnel:
   ```bash
   vercel tokens create
   ```

Important:
- le projet contient un `vercel.json` qui desactive les deploiements Git automatiques
- le deploiement passe par GitHub Actions pour garantir l'ordre `migrations -> deploy`
- pour que Google OAuth fonctionne en staging, il faut une URL stable: alias Vercel ou domaine custom

## 7. Configurer GitHub Actions
Ajouter les secrets GitHub suivants.

### Secrets communs Vercel
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

### Secrets production
- `PRODUCTION_DATABASE_URL`
- `PRODUCTION_DIRECT_URL`

### Secrets staging
- `STAGING_DATABASE_URL`
- `STAGING_DIRECT_URL`
- `STAGING_ALIAS_DOMAIN` si tu veux un domaine stable comme `staging.example.com`

Les autres variables d'application restent stockees dans Vercel, pas dans GitHub Actions.

## 8. Workflows GitHub inclus

### CI
Fichier: `.github/workflows/ci.yml`

Execute:
- `npm ci`
- `prisma generate`
- `prisma migrate deploy` sur une base PostgreSQL ephemere
- `npm run lint`
- `npm run build`
- `npm run test:auth`

### Staging
Fichier: `.github/workflows/deploy-staging.yml`

Declenchement:
- push sur `staging`
- ou `workflow_dispatch`

Execution:
- applique les migrations sur Neon staging
- recupere la config Vercel `preview`
- build Vercel
- deploie un preview build
- applique un alias stable si `STAGING_ALIAS_DOMAIN` est defini

### Production
Fichier: `.github/workflows/deploy-production.yml`

Declenchement:
- push sur `main`
- ou `workflow_dispatch`

Execution:
- applique les migrations sur Neon production
- recupere la config Vercel `production`
- build Vercel
- deploie en production

## 9. Procedure de deploiement

### Staging
```bash
git checkout -b staging
# commit + push
git push origin staging
```

Le workflow `Deploy Staging` s'executera si les secrets staging sont presents.

### Production
```bash
git checkout main
# merge ou commit final
git push origin main
```

Le workflow `Deploy Production` s'executera si les secrets production sont presents.

## 10. Tester que tout fonctionne en ligne
1. Ouvrir l'URL Vercel du bon environnement.
2. Verifier que `/manager` redirige vers `/manager/login`.
3. Cliquer `Se connecter avec Google`.
4. Se connecter avec un email autorise.
5. Verifier l'acces a la page manager.
6. Verifier qu'un compte non autorise est refuse.
7. Verifier qu'une operation ecriture manager fonctionne.
8. Verifier la deconnexion.

## 11. Commandes utiles
```bash
npm run db:up
npm run db:down
npm run db:logs
npx prisma migrate deploy
npm run lint
npm run build
npm run test:auth
npm run manager:upsert -- --email responsable@example.com --name "Responsable" --role PLANNER
```

## 12. Limitations connues
- le fallback `MANAGER_PASSWORD` existe encore pour le local, mais ne doit pas etre utilise en production
- les deploiements preview Vercel automatiques sont desactives par `vercel.json`; le staging passe par la branche `staging` et GitHub Actions
- sans alias ou domaine custom stable, Google OAuth ne sera pas fiable en staging
- l'UI manager ne propose pas encore une administration graphique des comptes managers autorises
- le serveur MCP n'est pas deploye dans cette phase

## 13. Evolution V2
- interface admin pour gerer `manager_access`
- ajout d'un domaine custom stable pour staging
- Microsoft OAuth si besoin reel en production
- deploiement du serveur MCP sur la meme base et le meme mapping `app_users`
