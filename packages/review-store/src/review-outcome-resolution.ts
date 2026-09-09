import { ReviewOutcomeRequestError } from "./errors.ts";
import type { ReviewOutcomeReader } from "./review-outcomes.ts";
import type { ReviewOutcomeTarget, StoredReviewOutcome } from "./types.ts";

export const REVIEW_OUTCOME_RESOLUTION_SCHEMA_VERSION = 1 as const;

export type ReviewOutcomeResolutionRequest = Readonly<{
  schemaVersion: typeof REVIEW_OUTCOME_RESOLUTION_SCHEMA_VERSION;
  targets: readonly ReviewOutcomeTarget[];
}>;

export type ReviewOutcomeResolutionResponse = Readonly<{
  schemaVersion: typeof REVIEW_OUTCOME_RESOLUTION_SCHEMA_VERSION;
  matches: readonly StoredReviewOutcome[];
}>;

function recordAt(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewOutcomeRequestError(`${location} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringAt(
  record: Record<string, unknown>,
  field: string,
  location: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ReviewOutcomeRequestError(
      `${location}.${field} must be a non-empty string.`,
    );
  }
  return value;
}

function parseTarget(value: unknown, index: number): ReviewOutcomeTarget {
  const location = `targets[${index}]`;
  const record = recordAt(value, location);
  const side = record.side;
  if (side !== "question" && side !== "answer") {
    throw new ReviewOutcomeRequestError(
      `${location}.side must be "question" or "answer".`,
    );
  }
  return {
    ragState: stringAt(record, "ragState", location),
    side,
    uuid: stringAt(record, "uuid", location),
  };
}

export function parseReviewOutcomeResolutionRequest(
  input: unknown,
): ReviewOutcomeResolutionRequest {
  const record = recordAt(input, "Request");
  if (record.schemaVersion !== REVIEW_OUTCOME_RESOLUTION_SCHEMA_VERSION) {
    throw new ReviewOutcomeRequestError(
      `schemaVersion must be ${REVIEW_OUTCOME_RESOLUTION_SCHEMA_VERSION}.`,
    );
  }
  if (!Array.isArray(record.targets)) {
    throw new ReviewOutcomeRequestError("targets must be an array.");
  }
  return {
    schemaVersion: REVIEW_OUTCOME_RESOLUTION_SCHEMA_VERSION,
    targets: record.targets.map(parseTarget),
  };
}

export function resolveReviewOutcomeRequest(
  input: unknown,
  reader: ReviewOutcomeReader,
): ReviewOutcomeResolutionResponse {
  const request = parseReviewOutcomeResolutionRequest(input);
  return {
    schemaVersion: REVIEW_OUTCOME_RESOLUTION_SCHEMA_VERSION,
    matches: reader.resolve(request.targets),
  };
}

export function resolveReviewOutcomeRequestJson(
  input: string,
  reader: ReviewOutcomeReader,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new ReviewOutcomeRequestError("Input must be valid JSON.");
  }
  return `${JSON.stringify(resolveReviewOutcomeRequest(parsed, reader))}\n`;
}
