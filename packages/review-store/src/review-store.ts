import { mkdirSync } from "node:fs";
import path from "node:path";

import { REVIEW_WORKSPACE_ROOT } from "@rtq/review-repository-paths";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { ReviewDatabaseError } from "./errors.ts";
import {
  createReviewCommentRepository,
  type ReviewCommentRepository,
} from "./review-comments.ts";
import {
  createReviewOutcomeRepository,
  createReviewOutcomeReader,
  type ReviewOutcomeReader,
  type ReviewOutcomeRepository,
} from "./review-outcomes.ts";
import * as schema from "./schema.ts";

export type ReviewStoreDatabase = ReturnType<typeof drizzle<typeof schema>>;

export type ReviewStore = Readonly<{
  close: () => void;
  comments: ReviewCommentRepository;
  outcomes: ReviewOutcomeRepository;
}>;

export type OpenReviewStoreOptions = Readonly<{
  databasePath?: string;
  migrationsFolder?: string;
  now?: () => Date;
}>;

type OpenReviewOutcomeReaderOptions = Readonly<{
  databasePath?: string;
}>;

export type OpenReviewOutcomeReader = ReviewOutcomeReader &
  Readonly<{ close: () => void }>;

export const REVIEW_DATABASE_PATH = path.join(
  REVIEW_WORKSPACE_ROOT,
  "database",
  "review-content.sqlite",
);

export const REVIEW_MIGRATIONS_FOLDER = path.join(
  REVIEW_WORKSPACE_ROOT,
  "packages",
  "review-store",
  "drizzle",
);

export function openReviewStore(
  options: OpenReviewStoreOptions = {},
): ReviewStore {
  const databasePath = options.databasePath ?? REVIEW_DATABASE_PATH;
  const migrationsFolder = options.migrationsFolder ?? REVIEW_MIGRATIONS_FOLDER;
  const now = options.now ?? (() => new Date());
  let sqlite: Database.Database | undefined;

  try {
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    sqlite = new Database(databasePath);
    const connection = sqlite;
    const db = drizzle(connection, { schema });
    migrate(db, { migrationsFolder });

    return {
      close: () => connection.close(),
      comments: createReviewCommentRepository(db, now),
      outcomes: createReviewOutcomeRepository(db, now, connection),
    };
  } catch (error) {
    try {
      sqlite?.close();
    } catch {
      // The recoverable error below is sufficient for callers.
    }
    throw new ReviewDatabaseError(
      "The review store is unavailable. Check the rtq-review database directory and migration files, then retry.",
      { cause: error },
    );
  }
}

export function openReviewOutcomeReader(
  options: OpenReviewOutcomeReaderOptions = {},
): OpenReviewOutcomeReader {
  const databasePath = options.databasePath ?? REVIEW_DATABASE_PATH;
  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(databasePath, {
      fileMustExist: true,
      readonly: true,
    });
    const connection = sqlite;
    return {
      close: () => connection.close(),
      ...createReviewOutcomeReader(connection),
    };
  } catch (error) {
    try {
      sqlite?.close();
    } catch {
      // The recoverable error below is sufficient for callers.
    }
    throw new ReviewDatabaseError(
      "The review outcome reader is unavailable. Check that the tracked rtq-review database exists and its migrations are current.",
      { cause: error },
    );
  }
}

declare global {
  var __rtqReviewStore: ReviewStore | undefined;
}

export function getReviewStore(): ReviewStore {
  globalThis.__rtqReviewStore ??= openReviewStore();
  return globalThis.__rtqReviewStore;
}
