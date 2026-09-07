import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { REVIEW_WORKSPACE_ROOT } from '@rtq/review-repository-paths';
import Database from 'better-sqlite3';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import type {
  LocalReviewComment,
  ReviewTargetIdentity,
} from '../lib/review-types.ts';

import { reviewComments } from './schema.ts';

export class ReviewDatabaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReviewDatabaseError';
  }
}

export class ReviewCommentConflictError extends Error {
  constructor() {
    super('That submission ID is already associated with another comment.');
    this.name = 'ReviewCommentConflictError';
  }
}

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
  close: () => void;
  listForTargets: (
    targets: readonly ReviewTargetIdentity[],
  ) => readonly LocalReviewComment[];
}>;

type OpenRepositoryOptions = Readonly<{
  databasePath?: string;
  migrationsFolder?: string;
  now?: () => Date;
}>;

export const REVIEW_COMMENT_DATABASE_PATH = path.join(
  REVIEW_WORKSPACE_ROOT,
  'database',
  'review-content.sqlite',
);

function migrationPath(): string {
  return path.join(process.cwd(), 'drizzle');
}

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

export function openReviewCommentRepository(
  options: OpenRepositoryOptions = {},
): ReviewCommentRepository {
  const databasePath = options.databasePath ?? REVIEW_COMMENT_DATABASE_PATH;
  const migrationsFolder = options.migrationsFolder ?? migrationPath();
  const now = options.now ?? (() => new Date());
  let sqlite: Database.Database | undefined;

  try {
    if (databasePath !== ':memory:') {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    sqlite = new Database(databasePath);
    const connection = sqlite;
    const db = drizzle(connection);
    migrate(db, { migrationsFolder });

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
                'The local comment could not be read after it was stored.',
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
            'The local comment could not be stored.',
            { cause: error },
          );
        }
      },
      close() {
        connection.close();
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
          throw new ReviewDatabaseError('Local comments could not be loaded.', {
            cause: error,
          });
        }
      },
    };
  } catch (error) {
    if (error instanceof ReviewCommentConflictError) throw error;
    try {
      sqlite?.close();
    } catch {
      // The recoverable error below is sufficient for the UI.
    }
    throw new ReviewDatabaseError(
      'Review comments are unavailable. Check the rtq-review database directory and migration files, then retry.',
      { cause: error },
    );
  }
}

declare global {
  var __rtqReviewCommentRepository: ReviewCommentRepository | undefined;
}

export function getReviewCommentRepository(): ReviewCommentRepository {
  globalThis.__rtqReviewCommentRepository ??= openReviewCommentRepository();
  return globalThis.__rtqReviewCommentRepository;
}
