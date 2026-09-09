CREATE TABLE `review_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`rtq_question_id` text NOT NULL,
	`rtq_uuid` text NOT NULL,
	`side` text NOT NULL,
	`rag_state` text NOT NULL,
	`comment` text NOT NULL,
	`reviewer` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "review_comments_side_check" CHECK("review_comments"."side" in ('question', 'answer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_comments_submission_id_unique` ON `review_comments` (`submission_id`);--> statement-breakpoint
CREATE INDEX `review_comments_identity_state_created_idx` ON `review_comments` (`rtq_question_id`,`rtq_uuid`,`side`,`rag_state`,`created_at`);