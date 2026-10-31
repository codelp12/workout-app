CREATE TABLE `spike_note` (
	`id` text PRIMARY KEY NOT NULL,
	`op_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spike_note_op_id_unique` ON `spike_note` (`op_id`);