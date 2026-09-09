import type { ReviewOutcomeDestination } from './review-types.ts';

export const reviewApiBaseUrl =
  process.env.RTQ_REVIEW_API_BASE_URL ?? 'http://localhost:4567';

export const reviewContentReviewer = process.env.RTQ_REVIEWER?.trim() || 'ap';

export function reviewOutcomeDestination(
  configured = process.env.RTQ_REVIEW_OUTCOME_DESTINATION,
): ReviewOutcomeDestination {
  const destination = configured?.trim().toLowerCase() || 'database';
  if (destination === 'database' || destination === 'google-sheets') {
    return destination;
  }
  throw new Error(
    'RTQ_REVIEW_OUTCOME_DESTINATION must be "database" or "google-sheets".',
  );
}
