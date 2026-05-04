/**
 * Shared constants for the BullMQ notifications outbox.
 *
 * Naming convention: kebab-case for both the queue name and individual
 * job names so they read naturally in BullMQ dashboards and Redis keys.
 */
export const NOTIFICATIONS_QUEUE = 'notifications';
export const SEND_NOTIFICATION_JOB = 'send-notification';

/**
 * Default BullMQ job options for `send-notification`. 3 attempts with
 * exponential backoff (5s, 25s, 125s — capped by BullMQ at 60s base
 * unless explicitly overridden) match the spec section 7.2.
 */
export const SEND_NOTIFICATION_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};
