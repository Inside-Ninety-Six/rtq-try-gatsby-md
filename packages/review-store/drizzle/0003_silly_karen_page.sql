CREATE TABLE `global_review_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`finding` text NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`reviewer` text NOT NULL,
	`created_at` text NOT NULL,
	`source_collection_id` text NOT NULL,
	`source_relative_path` text NOT NULL,
	`source_version` text NOT NULL,
	`source_paper_title` text NOT NULL,
	`source_node_id` text NOT NULL,
	`source_node_uuid` text,
	`source_node_label` text NOT NULL,
	`source_side` text NOT NULL,
	`processed_at` text,
	`processed_by` text,
	CONSTRAINT "global_review_findings_status_check" CHECK("global_review_findings"."status" in ('todo', 'processed')),
	CONSTRAINT "global_review_findings_processing_check" CHECK(("global_review_findings"."status" = 'todo' and "global_review_findings"."processed_at" is null and "global_review_findings"."processed_by" is null) or ("global_review_findings"."status" = 'processed' and "global_review_findings"."processed_at" is not null and "global_review_findings"."processed_by" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `global_review_findings_submission_id_unique` ON `global_review_findings` (`submission_id`);--> statement-breakpoint
CREATE INDEX `global_review_findings_status_created_idx` ON `global_review_findings` (`status`,`created_at`);