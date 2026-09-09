export type ReviewSide = "answer" | "question";

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
    outcome: string;
    reviewer: string;
    updatedAt: string;
  }>;

export type SetReviewOutcome = ReviewOutcomeTarget &
  Readonly<{
    outcome: string;
    reviewer: string;
  }>;
