# Deploiement web simple: Vercel + Neon

## Strategie retenue
- deploiement web par **Vercel** directement depuis GitHub
- base **PostgreSQL sur Neon**
- **GitHub Actions uniquement pour la CI**
- **migrations Prisma manuelles** quand le schema change

Cette approche est volontairement simple:
- pas de duplication de secrets Vercel dans GitHub Actions
- pas de pipeline CD complexe
- deploiement UI fiable aujourd'hui

Le serveur MCP reste hors scope pour cette phase.

## 1. Variables d'environnement Vercel
Dans Vercel, renseigner au minimum:

```bash
DATABASE_URL="<Neon pooled URL>"
DIRECT_URL="<Neon direct URL>"
AUTH_SECRET="<une-cle-longue-et-secrete>"
NEXTAUTH_URL="https://<ton-domaine-ou-projet>.vercel.app"
MANAGER_ALLOWED_EMAILS="responsable1@example.com,responsable2@example.com"
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

Regle:
- `DATABASE_URL` = URL Neon de runtime, idealement la pooled URL
- `DIRECT_URL` = URL Neon directe, pour Prisma CLI et migrations
- `NEXTAUTH_URL` = URL publique exacte de l'application, sans slash final

## 2. Configurer Neon
1. Creer un projet Neon.
2. Creer une base ou branche de production.
3. Recuperer:
   - l'URL pooled
   - l'URL directe
4. Les mettre dans Vercel:
   - `DATABASE_URL`
   - `DIRECT_URL`

Exemple:
```bash
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/horaire112?sslmode=require"
DIRECT_URL="postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/horaire112?sslmode=require"
```

## 3. Configurer Google OAuth
Dans Google Cloud:
1. Creer un client OAuth 2.0 de type `Web application`
2. Ajouter les redirect URIs:
   - local: `http://localhost:3000/api/auth/callback/google`
   - production: `https://<ton-domaine-ou-projet>.vercel.app/api/auth/callback/google`
3. Copier:
   - `AUTH_GOOGLE_ID`
   - `AUTH_GOOGLE_SECRET`
4. Definir dans Vercel:
   - `NEXTAUTH_URL="https://<ton-domaine-ou-projet>.vercel.app"`

## 4. Autoriser les managers
Option simple:
```bash
MANAGER_ALLOWED_EMAILS="responsable1@example.com,responsable2@example.com"
```

Option durable en base:
```bash
DATABASE_URL="<Neon pooled URL>" \
DIRECT_URL="<Neon direct URL>" \
npm run manager:upsert -- --email responsable@example.com --name "Responsable" --role PLANNER
```

Important:
- l'email doit correspondre exactement au compte Google utilise pour se connecter
- un compte authentifie mais non autorise est refuse

## 5. Migrations Prisma
Les migrations ne sont pas lancees automatiquement par Vercel.

Quand le schema Prisma change:
1. pousser le code
2. lancer la migration manuellement contre Neon
3. redeployer l'application depuis Vercel

Commande:
```bash
DATABASE_URL="<Neon pooled URL>" \
DIRECT_URL="<Neon direct URL>" \
npx prisma migrate deploy
```

Tu peux lancer cette commande:
- depuis ta machine locale
- ou depuis un shell CI ponctuel

## 6. Connecter le repo a Vercel
1. Aller dans Vercel
2. `Add New...` -> `Project`
3. Importer le repository GitHub
4. Laisser le preset `Next.js`
5. Ajouter les variables d'environnement Vercel
6. Sauvegarder
7. Lancer le premier deploiement

Ensuite, a chaque `push` sur la branche connectee:
- Vercel rebuild et redeploie automatiquement

## 7. Re-lancer un deploiement depuis Vercel

### Methode dashboard
1. Ouvrir Vercel
2. Aller sur ton projet
3. Ouvrir l'onglet `Deployments`
4. Choisir le deploiement voulu
5. Cliquer sur le menu `...`
6. Cliquer `Redeploy`
7. Choisir de redeployer:
   - avec le meme build
   - ou en reconstruisant

Pour un vrai correctif applicatif, choisis de preference un redeploiement avec rebuild.

### Methode apres changement de variables d'environnement
Si tu modifies:
- `DATABASE_URL`
- `DIRECT_URL`
- `AUTH_SECRET`
- `NEXTAUTH_URL`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `MANAGER_ALLOWED_EMAILS`

alors redeploie depuis `Deployments` -> `Redeploy` pour que la nouvelle config soit prise en compte.

## 8. Ordre recommande en production

### Cas 1: changement sans schema DB
1. pousser sur GitHub
2. laisser Vercel deployer automatiquement

### Cas 2: changement avec schema DB
1. pousser sur GitHub
2. lancer:
   ```bash
   DATABASE_URL="<Neon pooled URL>" \
   DIRECT_URL="<Neon direct URL>" \
   npx prisma migrate deploy
   ```
3. redeployer depuis Vercel

## 9. GitHub Actions
GitHub Actions est conserve uniquement pour:
- `npm ci`
- `prisma generate`
- `prisma migrate deploy` sur une base PostgreSQL ephemere de CI
- `npm run lint`
- `npm run build`
- `npm run test:auth`

Le workflow actif est:
- `.github/workflows/ci.yml`

## 10. Verification en ligne
1. Ouvrir l'URL publique
2. Verifier que `/manager` redirige vers `/manager/login`
3. Cliquer `Se connecter avec Google`
4. Se connecter avec un email autorise
5. Verifier l'acces a la page manager
6. Verifier qu'un email non autorise est refuse
7. Verifier qu'une operation manager fonctionne
8. Verifier la deconnexion

## 11. Commandes utiles
```bash
npm run db:up
npm run db:down
npm run db:logs
npx prisma migrate deploy
npm run lint
npm run build
npm run test:auth
```

## 12. Limitations connues
- les migrations Prisma restent manuelles
- il n'y a pas encore d'UI admin pour gerer `manager_access`
- Microsoft OAuth reste optionnel et non necessaire pour le deploiement actuel
