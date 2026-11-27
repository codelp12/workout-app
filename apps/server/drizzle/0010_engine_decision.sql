CREATE TABLE `engine_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`engine_version` text NOT NULL,
	`inputs` text NOT NULL,
	`rules` text NOT NULL,
	`outputs` text NOT NULL
);
