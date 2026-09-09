CREATE TABLE `review_outcomes` (
	`rtq_uuid` text NOT NULL,
	`side` text NOT NULL,
	`rag_state` text NOT NULL,
	`outcome` text NOT NULL,
	`reviewer` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "review_outcomes_side_check" CHECK("review_outcomes"."side" in ('question', 'answer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_outcomes_identity_state_unique` ON `review_outcomes` (`rtq_uuid`,`side`,`rag_state`);--> statement-breakpoint
CREATE INDEX `review_outcomes_updated_idx` ON `review_outcomes` (`updated_at`);