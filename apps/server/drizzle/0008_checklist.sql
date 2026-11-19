CREATE TABLE `checklist` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`kind` text NOT NULL,
	`session_type` text NOT NULL,
	`items` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `checklist_server_seq_idx` ON `checklist` (`server_seq`);--> statement-breakpoint
ALTER TABLE `session_log` ADD `checked` text DEFAULT '[]' NOT NULL;