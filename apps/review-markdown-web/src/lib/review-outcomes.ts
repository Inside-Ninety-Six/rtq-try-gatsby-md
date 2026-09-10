export const CANONICAL_REVIEW_OUTCOMES = [
  'PRG',
  'PRCR',
  'PRCC',
  'PRBD',
  'PRCS',
] as const;

export type CanonicalReviewOutcome = (typeof CANONICAL_REVIEW_OUTCOMES)[number];
export type ReviewOutcomeSelection = CanonicalReviewOutcome | '';

const REVIEW_OUTCOME_ACTIONS = ['rag', 'question-rag'] as const;

export class ReviewOutcomeRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewOutcomeRequestError';
  }
}

export function isReviewOutcomeSelection(
  value: unknown,
): value is ReviewOutcomeSelection {
  return (
    value === '' ||
    (typeof value === 'string' &&
      (CANONICAL_REVIEW_OUTCOMES as readonly string[]).includes(value))
  );
}

export function isReviewOutcomeAction(value: string): boolean {
  return (REVIEW_OUTCOME_ACTIONS as readonly string[]).includes(value);
}

export function parseReviewOutcomeRequestBody(body: string): string {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new ReviewOutcomeRequestError(
      'The review request body must be valid JSON.',
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReviewOutcomeRequestError(
      'The review request body must be an object.',
    );
  }
  const request = value as Record<string, unknown>;
  if (!isReviewOutcomeSelection(request.rag)) {
    throw new ReviewOutcomeRequestError('The review outcome is not supported.');
  }
  return JSON.stringify(request);
}
