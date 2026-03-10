# Migration `assignments.lane` sur Neon

## Objectif

Ajouter un champ nullable `lane` (`A1` / `A2`) sur `assignments` pour permettre
les validations explicites par rôle dans le planning mensuel.

Cette migration est **non destructive** :

- aucune table n'est supprimée
- aucune colonne existante n'est modifiée ou supprimée
- les affectations existantes restent en place avec `lane = NULL`
- le code reste compatible avec les anciennes lignes `NULL`

## Contenu de la migration

- création de l'enum PostgreSQL `AssignmentLane`
- ajout de la colonne nullable `assignments.lane`
- ajout d'un index de lecture sur `planning_month_id, lane, start_time, end_time`

Fichier :

- [`/Users/rm/PRIVATE/horaire112/prisma/migrations-postgres/20260310161000_add_assignment_lane/migration.sql`](/Users/rm/PRIVATE/horaire112/prisma/migrations-postgres/20260310161000_add_assignment_lane/migration.sql)

## Vérifications SQL préparées

Script de contrôle :

- [`/Users/rm/PRIVATE/horaire112/scripts/sql/verify_assignment_lane_migration.sql`](/Users/rm/PRIVATE/horaire112/scripts/sql/verify_assignment_lane_migration.sql)

Ce script permet de vérifier :

- le nombre total d'affectations
- le nombre de lignes avec / sans `lane`
- la présence de la colonne `lane`

## Procédure recommandée sur Neon

### 1. Créer une branche de test depuis la prod

Dans Neon :

1. ouvrir le projet
2. ouvrir la branche de production
3. créer une nouvelle branche, par exemple `assignment-lane-test`

Récupérer ensuite pour cette branche :

- `DATABASE_URL`
- `DIRECT_URL`

## 2. Prendre un snapshot avant migration

Dans le SQL editor Neon de la branche de test, exécuter :

```sql
SELECT COUNT(*) AS assignment_count
FROM assignments;

SELECT
  COUNT(*) AS total_assignments,
  COUNT(lane) AS assignments_with_lane,
  COUNT(*) FILTER (WHERE lane IS NULL) AS assignments_without_lane
FROM assignments;
```

Noter le total d'affectations. Après migration, ce total doit rester identique.

## 3. Appliquer la migration sur la branche de test

Depuis le repo local :

```bash
DATABASE_URL="postgresql://..." \
DIRECT_URL="postgresql://..." \
npx prisma migrate deploy
```

## 4. Vérifier la migration sur la branche de test

Dans Neon SQL editor, exécuter le contenu de :

- [`/Users/rm/PRIVATE/horaire112/scripts/sql/verify_assignment_lane_migration.sql`](/Users/rm/PRIVATE/horaire112/scripts/sql/verify_assignment_lane_migration.sql)

Résultat attendu :

- `assignment_count` identique à avant migration
- `assignments_without_lane = total_assignments` tant qu'aucune nouvelle affectation par rôle n'a été créée
- la colonne `lane` existe et est nullable

## 5. Tester localement contre la branche Neon clonée

Créer un fichier d'environnement local pointant vers la branche Neon de test, ou exporter les variables avant de lancer l'app :

```bash
export DATABASE_URL="postgresql://..."
export DIRECT_URL="postgresql://..."
export NEXTAUTH_URL="http://localhost:3000"

npx prisma generate
npm run dev
```

Puis vérifier dans l'interface manager :

1. sur un créneau jaune/orange, cliquer `Valider A1` ou `Valider A2`
2. constater que seule la ligne ciblée devient verte
3. constater que l'autre ligne reste calculée normalement
4. cliquer sur le bloc confirmé
5. utiliser `Désinscrire A1` ou `Désinscrire A2`
6. vérifier que l'état redevient dynamique après rechargement

## 6. Appliquer en production

Seulement après validation de la branche de test :

```bash
DATABASE_URL="postgresql://<prod pooled url>" \
DIRECT_URL="postgresql://<prod direct url>" \
npx prisma migrate deploy
```

## 7. Vérifier la production après migration

Dans Neon prod :

```sql
SELECT COUNT(*) AS assignment_count
FROM assignments;

SELECT
  COUNT(*) AS total_assignments,
  COUNT(lane) AS assignments_with_lane,
  COUNT(*) FILTER (WHERE lane IS NULL) AS assignments_without_lane
FROM assignments;
```

Résultat attendu juste après migration :

- même nombre total d'affectations qu'avant
- `assignments_with_lane = 0` si aucune nouvelle validation par rôle n'a encore été faite
- `assignments_without_lane = total_assignments`

## Pourquoi cette migration est sûre

Elle est sûre parce que :

- elle ajoute une colonne nullable seulement
- les anciennes données restent lisibles sans backfill
- le code gère à la fois les affectations historiques `NULL` et les nouvelles affectations `A1/A2`

Le backfill éventuel des anciennes affectations vers `A1/A2` n'est **pas** nécessaire pour cette V1.
