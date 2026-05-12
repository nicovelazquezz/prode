-- Change notifications.userId FK from ON DELETE CASCADE to ON DELETE SET NULL.
-- Rationale: hard-deleting a user must preserve their notification history for
-- audit (was the WA pago_pendiente delivered? did the magic link reach them?).
-- Without this, every audit chain dies with the user.
--
-- Safe operation: re-creates the constraint in place; no data rewrite, no lock
-- on the data — Postgres only updates the constraint metadata.

ALTER TABLE "notifications" DROP CONSTRAINT "notifications_userId_fkey";

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
