import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import {
  ReviewDatabaseError,
  ReviewFindingConflictError,
  ReviewStoreValidationError,
} from "./errors.ts";
import { globalReviewFindings } from "./schema.ts";
import type { ReviewStoreDatabase } from "./review-store.ts";
import type { GlobalReviewFinding, ReviewSide } from "./types.ts";

export type AppendGlobalReviewFinding = Readonly<{
  finding: string;
  reviewer: string;
  sourceCollectionId: string;
  sourceNodeId: string;
  sourceNodeLabel: string;
  sourceNodeUuid: string | null;
  sourcePaperTitle: string;
  sourceRelativePath: string;
  sourceSide: ReviewSide;
  sourceVersion: string;
  submissionId: string;
}>;

export type ProcessGlobalReviewFinding = Readonly<{
  id: string;
  processedBy: string;
}>;

export type GlobalReviewFindingRepository = Readonly<{
  append: (
    input: AppendGlobalReviewFinding,
  ) => Readonly<{ created: boolean; finding: GlobalReviewFinding }>;
  listTodo: () => readonly GlobalReviewFinding[];
  markProcessed: (
    input: ProcessGlobalReviewFinding,
  ) => Readonly<{ changed: boolean; finding: GlobalReviewFinding }> | undefined;
}>;

function requireValue(field: string, value: string): void {
  if (!value.trim()) throw new ReviewStoreValidationError(field);
}

function validateSide(side: ReviewSide): void {
  if (side !== "answer" && side !== "question") {
    throw new ReviewStoreValidationError("sourceSide");
  }
}

function validateAppend(input: AppendGlobalReviewFinding): void {
  for (const [field, value] of Object.entries(input)) {
    if (field !== "sourceNodeUuid" && typeof value === "string") {
      requireValue(field, value);
    }
  }
  if (input.sourceNodeUuid !== null) {
    requireValue("sourceNodeUuid", input.sourceNodeUuid);
  }
  validateSide(input.sourceSide);
}

function toFinding(
  row: typeof globalReviewFindings.$inferSelect,
): GlobalReviewFinding {
  return {
    createdAt: row.createdAt,
    finding: row.finding,
    id: row.id,
    processedAt: row.processedAt,
    processedBy: row.processedBy,
    reviewer: row.reviewer,
    sourceCollectionId: row.sourceCollectionId,
    sourceNodeId: row.sourceNodeId,
    sourceNodeLabel: row.sourceNodeLabel,
    sourceNodeUuid: row.sourceNodeUuid,
    sourcePaperTitle: row.sourcePaperTitle,
    sourceRelativePath: row.sourceRelativePath,
    sourceSide: row.sourceSide,
    sourceVersion: row.sourceVersion,
    status: row.status,
    submissionId: row.submissionId,
  };
}

function sameSubmission(
  stored: typeof globalReviewFindings.$inferSelect,
  input: AppendGlobalReviewFinding,
): boolean {
  return (
    stored.submissionId === input.submissionId &&
    stored.finding === input.finding &&
    stored.reviewer === input.reviewer &&
    stored.sourceCollectionId === input.sourceCollectionId &&
    stored.sourceRelativePath === input.sourceRelativePath &&
    stored.sourceVersion === input.sourceVersion &&
    stored.sourcePaperTitle === input.sourcePaperTitle &&
    stored.sourceNodeId === input.sourceNodeId &&
    stored.sourceNodeUuid === input.sourceNodeUuid &&
    stored.sourceNodeLabel === input.sourceNodeLabel &&
    stored.sourceSide === input.sourceSide
  );
}

export function createGlobalReviewFindingRepository(
  db: ReviewStoreDatabase,
  now: () => Date,
): GlobalReviewFindingRepository {
  return {
    append(input) {
      validateAppend(input);
      try {
        return db.transaction((transaction) => {
          const insertion = transaction
            .insert(globalReviewFindings)
            .values({
              ...input,
              createdAt: now().toISOString(),
              id: randomUUID(),
              status: "todo",
            })
            .onConflictDoNothing({
              target: globalReviewFindings.submissionId,
            })
            .run();
          const stored = transaction
            .select()
            .from(globalReviewFindings)
            .where(eq(globalReviewFindings.submissionId, input.submissionId))
            .get();
          if (!stored) {
            throw new ReviewDatabaseError(
              "The global finding could not be read after it was stored.",
            );
          }
          if (!sameSubmission(stored, input)) {
            throw new ReviewFindingConflictError();
          }
          return {
            created: insertion.changes === 1,
            finding: toFinding(stored),
          };
        });
      } catch (error) {
        if (
          error instanceof ReviewDatabaseError ||
          error instanceof ReviewFindingConflictError ||
          error instanceof ReviewStoreValidationError
        ) {
          throw error;
        }
        throw new ReviewDatabaseError(
          "The global finding could not be stored.",
          {
            cause: error,
          },
        );
      }
    },
    listTodo() {
      try {
        return db
          .select()
          .from(globalReviewFindings)
          .where(eq(globalReviewFindings.status, "todo"))
          .orderBy(
            asc(globalReviewFindings.createdAt),
            asc(globalReviewFindings.id),
          )
          .all()
          .map(toFinding);
      } catch (error) {
        throw new ReviewDatabaseError("Global findings could not be loaded.", {
          cause: error,
        });
      }
    },
    markProcessed(input) {
      requireValue("id", input.id);
      requireValue("processedBy", input.processedBy);
      try {
        return db.transaction((transaction) => {
          const existing = transaction
            .select()
            .from(globalReviewFindings)
            .where(eq(globalReviewFindings.id, input.id))
            .get();
          if (!existing) return undefined;
          if (existing.status === "processed") {
            return { changed: false, finding: toFinding(existing) };
          }
          const processedAt = now().toISOString();
          const update = transaction
            .update(globalReviewFindings)
            .set({
              processedAt,
              processedBy: input.processedBy,
              status: "processed",
            })
            .where(
              and(
                eq(globalReviewFindings.id, input.id),
                eq(globalReviewFindings.status, "todo"),
              ),
            )
            .run();
          const stored = transaction
            .select()
            .from(globalReviewFindings)
            .where(eq(globalReviewFindings.id, input.id))
            .get();
          if (!stored) {
            throw new ReviewDatabaseError(
              "The processed global finding could not be read.",
            );
          }
          return { changed: update.changes === 1, finding: toFinding(stored) };
        });
      } catch (error) {
        if (
          error instanceof ReviewDatabaseError ||
          error instanceof ReviewStoreValidationError
        ) {
          throw error;
        }
        throw new ReviewDatabaseError(
          "The global finding could not be marked processed.",
          { cause: error },
        );
      }
    },
  };
}
