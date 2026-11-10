CREATE TABLE `problem_report` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`text` text NOT NULL,
	`app_build` text NOT NULL,
	`screen` text,
	`user_agent` text NOT NULL,
	`sync_status` text NOT NULL,
	`status` text NOT NULL,
	`github_issue` integer
);
--> statement-breakpoint
CREATE INDEX `problem_report_server_seq_idx` ON `problem_report` (`server_seq`);--> statement-breakpoint
CREATE INDEX `problem_report_status_idx` ON `problem_report` (`status`);