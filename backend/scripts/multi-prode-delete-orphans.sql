-- Multi-prode: delete orphan rows after the backup, asserting NULL counts
-- reach zero so the M2 NOT NULL constraint can be applied safely.
--
-- Pre-requisite: run multi-prode-backup-orphans.sql first (otherwise the
-- orphan rows are lost without a backup).
--
-- Run:  PGPASSWORD=... psql -h localhost -p 5433 -U prode -d prode \
--         -f backend/scripts/multi-prode-delete-orphans.sql

\set ON_ERROR_STOP on

BEGIN;

DELETE FROM predictions WHERE "entryId" IS NULL;
DELETE FROM special_predictions WHERE "entryId" IS NULL;
DELETE FROM phase_winners WHERE "entryId" IS NULL;
DELETE FROM league_memberships WHERE "entryId" IS NULL;

DO $$
DECLARE
  c_predictions       BIGINT;
  c_special           BIGINT;
  c_phase_winners     BIGINT;
  c_league_membership BIGINT;
BEGIN
  SELECT COUNT(*) INTO c_predictions FROM predictions WHERE "entryId" IS NULL;
  SELECT COUNT(*) INTO c_special FROM special_predictions WHERE "entryId" IS NULL;
  SELECT COUNT(*) INTO c_phase_winners FROM phase_winners WHERE "entryId" IS NULL;
  SELECT COUNT(*) INTO c_league_membership FROM league_memberships WHERE "entryId" IS NULL;

  IF c_predictions       > 0 THEN RAISE EXCEPTION 'predictions still has % rows with entryId NULL', c_predictions; END IF;
  IF c_special           > 0 THEN RAISE EXCEPTION 'special_predictions still has % rows with entryId NULL', c_special; END IF;
  IF c_phase_winners     > 0 THEN RAISE EXCEPTION 'phase_winners still has % rows with entryId NULL', c_phase_winners; END IF;
  IF c_league_membership > 0 THEN RAISE EXCEPTION 'league_memberships still has % rows with entryId NULL', c_league_membership; END IF;

  RAISE NOTICE 'All four tables clean (entryId NOT NULL). Safe to apply M2.';
END $$;

COMMIT;
