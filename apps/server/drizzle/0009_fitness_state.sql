CREATE TABLE `fitness_state` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`metric` text NOT NULL,
	`exercise_id` text,
	`date` text NOT NULL,
	`value` real NOT NULL,
	`unit` text,
	`confidence` real,
	`engine_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `fitness_state_server_seq_idx` ON `fitness_state` (`server_seq`);--> statement-breakpoint
CREATE INDEX `fitness_state_exercise_id_idx` ON `fitness_state` (`exercise_id`);