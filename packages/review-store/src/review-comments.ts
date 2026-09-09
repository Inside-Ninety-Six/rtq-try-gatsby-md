import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull, or } from "drizzle-orm";

import { ReviewCommentConflictError, ReviewDatabaseError } from "./errors.ts";
import { reviewComments } from "./schema.ts";
import type { ReviewStoreDatabase } from "./review-store.ts";
import type { LocalReviewComment, ReviewTargetIdentity } from "./types.ts";

export type AppendReviewComment = ReviewTargetIdentity &
  Readonly<{
    comment: string;
    ragState: string;
    reviewer: string;
    submissionId: string;
  }>;

export type ReviewCommentRepository = Readonly<{
  append: (
    input: AppendReviewComment,
  ) => Readonly<{ comment: LocalReviewComment; created: boolean }>;
  listForTargets: (
    targets: readonly ReviewTargetIdentity[],
  ) => readonly LocalReviewComment[];
}>;

function toComment(
  row: typeof reviewComments.$inferSelect,
): LocalReviewComment {
  return {
    comment: row.comment,
    createdAt: row.createdAt,
    id: row.id,
    questionId: row.questionId,
    ragState: row.ragState,
    reviewer: row.reviewer,
    side: row.side,
    submissionId: row.submissionId,
    uuid: row.uuid,
  };
}

function sameSubmission(
  stored: typeof reviewComments.$inferSelect,
  input: AppendReviewComment,
): boolean {
  return (
    stored.submissionId === input.submissionId &&
    stored.questionId === input.questionId &&
    stored.uuid === input.uuid &&
    stored.side === input.side &&
    stored.ragState === input.ragState &&
    stored.comment === input.comment &&
    stored.reviewer === input.reviewer
  );
}

export function createReviewCommentRepository(
  db: ReviewStoreDatabase,
  now: () => Date,
): ReviewCommentRepository {
  return {
    append(input) {
      try {
        return db.transaction((transaction) => {
          const insertion = transaction
            .insert(reviewComments)
            .values({
              comment: input.comment,
              createdAt: now().toISOString(),
              id: randomUUID(),
              questionId: input.questionId,
              ragState: input.ragState,
              reviewer: input.reviewer,
              side: input.side,
              submissionId: input.submissionId,
              uuid: input.uuid,
            })
            .onConflictDoNothing({ target: reviewComments.submissionId })
            .run();

          const stored = transaction
            .select()
            .from(reviewComments)
            .where(eq(reviewComments.submissionId, input.submissionId))
            .get();
          if (!stored) {
            throw new ReviewDatabaseError(
              "The local comment could not be read after it was stored.",
            );
          }
          if (!sameSubmission(stored, input)) {
            throw new ReviewCommentConflictError();
          }
          return {
            comment: toComment(stored),
            created: insertion.changes === 1,
          };
        });
      } catch (error) {
        if (
          error instanceof ReviewCommentConflictError ||
          error instanceof ReviewDatabaseError
        ) {
          throw error;
        }
        throw new ReviewDatabaseError(
          "The local comment could not be stored.",
          {
            cause: error,
          },
        );
      }
    },
    listForTargets(targets) {
      if (targets.length === 0) return [];
      try {
        const predicates = targets.map((target) =>
          and(
            eq(reviewComments.uuid, target.uuid),
            target.questionId === null
              ? isNull(reviewComments.questionId)
              : eq(reviewComments.questionId, target.questionId),
            eq(reviewComments.side, target.side),
          ),
        );
        const where = or(...predicates);
        if (!where) return [];
        return db
          .select()
          .from(reviewComments)
          .where(where)
          .orderBy(asc(reviewComments.createdAt), asc(reviewComments.id))
          .all()
          .map(toComment);
      } catch (error) {
        throw new ReviewDatabaseError("Local comments could not be loaded.", {
          cause: error,
        });
      }
    },
  };
}
