export type ReviewSide = "answer" | "question";

export const GLOBAL_REVIEW_FINDING_STATUSES = ["todo", "processed"] as const;

export type GlobalReviewFindingStatus =
  (typeof GLOBAL_REVIEW_FINDING_STATUSES)[number];

export type GlobalReviewFinding = Readonly<{
  createdAt: string;
  finding: string;
  id: string;
  processedAt: string | null;
  processedBy: string | null;
  reviewer: string;
  sourceCollectionId: string;
  sourceNodeId: string;
  sourceNodeLabel: string;
  sourceNodeUuid: string | null;
  sourcePaperTitle: string;
  sourceRelativePath: string;
  sourceSide: ReviewSide;
  sourceVersion: string;
  status: GlobalReviewFindingStatus;
  submissionId: string;
}>;

export const REVIEW_OUTCOMES = [
  "PRNS",
  "PRG",
  "PRBD",
  "PRCS",
  "PRCR",
  "PRCC",
] as const;

export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

export const LEGACY_REVIEW_OUTCOME_CONSOLIDATIONS = {
  PRA: "PRBD",
  PRG2: "PRG",
  PRPCC: "PRG",
  PRR: "PRBD",
} as const satisfies Readonly<Record<string, ReviewOutcome>>;

export const REMOVED_REVIEW_OUTCOMES = ["PRPCR", "PRRL", "PRCT"] as const;

export function isReviewOutcome(value: unknown): value is ReviewOutcome {
  return (
    typeof value === "string" &&
    (REVIEW_OUTCOMES as readonly string[]).includes(value)
  );
}

export type ReviewTargetIdentity = Readonly<{
  questionId: string | null;
  side: ReviewSide;
  uuid: string;
}>;

export type LocalReviewComment = ReviewTargetIdentity &
  Readonly<{
    comment: string;
    createdAt: string;
    id: string;
    ragState: string;
    reviewer: string;
    submissionId: string;
  }>;

export type ReviewOutcomeTarget = Readonly<{
  ragState: string;
  side: ReviewSide;
  uuid: string;
}>;

export type StoredReviewOutcome = ReviewOutcomeTarget &
  Readonly<{
    createdAt: string;
    outcome: ReviewOutcome;
    reviewer: string;
    updatedAt: string;
  }>;

export type SetReviewOutcome = ReviewOutcomeTarget &
  Readonly<{
    outcome: ReviewOutcome;
    reviewer: string;
  }>;
