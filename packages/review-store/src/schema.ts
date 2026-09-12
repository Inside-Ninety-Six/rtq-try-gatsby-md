import { sql } from "drizzle-orm";
import {
  check,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const globalReviewFindings = sqliteTable(
  "global_review_findings",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull(),
    finding: text("finding").notNull(),
    status: text("status", { enum: ["todo", "processed"] })
      .notNull()
      .default("todo"),
    reviewer: text("reviewer").notNull(),
    createdAt: text("created_at").notNull(),
    sourceCollectionId: text("source_collection_id").notNull(),
    sourceRelativePath: text("source_relative_path").notNull(),
    sourceVersion: text("source_version").notNull(),
    sourcePaperTitle: text("source_paper_title").notNull(),
    sourceNodeId: text("source_node_id").notNull(),
    sourceNodeUuid: text("source_node_uuid"),
    sourceNodeLabel: text("source_node_label").notNull(),
    sourceSide: text("source_side", {
      enum: ["question", "answer"],
    }).notNull(),
    processedAt: text("processed_at"),
    processedBy: text("processed_by"),
  },
  (table) => [
    check(
      "global_review_findings_status_check",
      sql`${table.status} in ('todo', 'processed')`,
    ),
    check(
      "global_review_findings_processing_check",
      sql`(${table.status} = 'todo' and ${table.processedAt} is null and ${table.processedBy} is null) or (${table.status} = 'processed' and ${table.processedAt} is not null and ${table.processedBy} is not null)`,
    ),
    uniqueIndex("global_review_findings_submission_id_unique").on(
      table.submissionId,
    ),
    index("global_review_findings_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const reviewComments = sqliteTable(
  "review_comments",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull(),
    questionId: text("rtq_question_id"),
    uuid: text("rtq_uuid").notNull(),
    side: text("side", { enum: ["question", "answer"] }).notNull(),
    ragState: text("rag_state").notNull(),
    comment: text("comment").notNull(),
    reviewer: text("reviewer").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "review_comments_side_check",
      sql`${table.side} in ('question', 'answer')`,
    ),
    uniqueIndex("review_comments_submission_id_unique").on(table.submissionId),
    index("review_comments_identity_state_created_idx").on(
      table.uuid,
      table.questionId,
      table.side,
      table.ragState,
      table.createdAt,
    ),
  ],
);

export const reviewOutcomes = sqliteTable(
  "review_outcomes",
  {
    uuid: text("rtq_uuid").notNull(),
    side: text("side", { enum: ["question", "answer"] }).notNull(),
    ragState: text("rag_state").notNull(),
    outcome: text("outcome").notNull(),
    reviewer: text("reviewer").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "review_outcomes_side_check",
      sql`${table.side} in ('question', 'answer')`,
    ),
    uniqueIndex("review_outcomes_identity_state_unique").on(
      table.uuid,
      table.side,
      table.ragState,
    ),
    index("review_outcomes_updated_idx").on(table.updatedAt),
  ],
);
