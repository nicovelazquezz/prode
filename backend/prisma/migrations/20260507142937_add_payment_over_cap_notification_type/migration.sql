-- AlterEnum
-- Add PAYMENT_OVER_CAP to NotificationType so payments.service.ts can persist
-- the alert it already constructs when a user attempts to exceed
-- max_entries_per_user.
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_OVER_CAP';
