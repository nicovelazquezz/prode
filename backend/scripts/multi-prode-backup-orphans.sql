-- Multi-prode: backup orphan rows (entryId IS NULL after backfill) before
-- the destructive DELETE that multi-prode-delete-orphans.sql performs.
--
-- An "orphan" is a Prediction/SpecialPrediction/PhaseWinner/LeagueMembership
-- whose owning user never had an APPROVED Payment, so the backfill could not
-- attach an Entry. These rows are functionally invalid (the user never paid)
-- and would block the M2 NOT NULL constraint.
--
-- The backup tables use a fixed-date suffix (2026_05_XX) per the spec; they
-- are dropped + recreated each run so a re-run never mixes vintages of data.
-- Retain 30 days then drop manually.
--
-- Run:  PGPASSWORD=... psql -h localhost -p 5433 -U prode -d prode \
--         -f backend/scripts/multi-prode-backup-orphans.sql

\set ON_ERROR_STOP on

BEGIN;

DROP TABLE IF EXISTS predictions_orphaned_backup_2026_05_XX;
CREATE TABLE predictions_orphaned_backup_2026_05_XX AS
  SELECT * FROM predictions WHERE "entryId" IS NULL;
COMMENT ON TABLE predictions_orphaned_backup_2026_05_XX
  IS 'Orphan predictions (no APPROVED payment for user) backed up before multi-prode M2 migration. Retain 30 days then drop.';

DROP TABLE IF EXISTS special_predictions_orphaned_backup_2026_05_XX;
CREATE TABLE special_predictions_orphaned_backup_2026_05_XX AS
  SELECT * FROM special_predictions WHERE "entryId" IS NULL;
COMMENT ON TABLE special_predictions_orphaned_backup_2026_05_XX
  IS 'Orphan special_predictions backed up before multi-prode M2 migration. Retain 30 days then drop.';

DROP TABLE IF EXISTS phase_winners_orphaned_backup_2026_05_XX;
CREATE TABLE phase_winners_orphaned_backup_2026_05_XX AS
  SELECT * FROM phase_winners WHERE "entryId" IS NULL;
COMMENT ON TABLE phase_winners_orphaned_backup_2026_05_XX
  IS 'Orphan phase_winners backed up before multi-prode M2 migration. Retain 30 days then drop.';

DROP TABLE IF EXISTS league_memberships_orphaned_backup_2026_05_XX;
CREATE TABLE league_memberships_orphaned_backup_2026_05_XX AS
  SELECT * FROM league_memberships WHERE "entryId" IS NULL;
COMMENT ON TABLE league_memberships_orphaned_backup_2026_05_XX
  IS 'Orphan league_memberships backed up before multi-prode M2 migration. Retain 30 days then drop.';

COMMIT;

-- Sanity report: how many rows were backed up per table.
SELECT 'predictions_orphaned_backup_2026_05_XX' AS table_name, COUNT(*) AS rows
  FROM predictions_orphaned_backup_2026_05_XX
UNION ALL
SELECT 'special_predictions_orphaned_backup_2026_05_XX', COUNT(*)
  FROM special_predictions_orphaned_backup_2026_05_XX
UNION ALL
SELECT 'phase_winners_orphaned_backup_2026_05_XX', COUNT(*)
  FROM phase_winners_orphaned_backup_2026_05_XX
UNION ALL
SELECT 'league_memberships_orphaned_backup_2026_05_XX', COUNT(*)
  FROM league_memberships_orphaned_backup_2026_05_XX;
