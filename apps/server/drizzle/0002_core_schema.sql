CREATE TABLE `ascent` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`session_log_id` text NOT NULL,
	`project_id` text,
	`grade` text NOT NULL,
	`style` text NOT NULL,
	`attempts` integer NOT NULL,
	`tags` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ascent_server_seq_idx` ON `ascent` (`server_seq`);--> statement-breakpoint
CREATE INDEX `ascent_session_log_id_idx` ON `ascent` (`session_log_id`);--> statement-breakpoint
CREATE INDEX `ascent_project_id_idx` ON `ascent` (`project_id`);--> statement-breakpoint
CREATE TABLE `block` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`name` text,
	`start_date` text NOT NULL,
	`week_count` integer NOT NULL,
	`engine_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `block_server_seq_idx` ON `block` (`server_seq`);--> statement-breakpoint
CREATE TABLE `exercise` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`name` text NOT NULL,
	`aliases` text NOT NULL,
	`modality` text NOT NULL,
	`movement_pattern` text,
	`primary_muscles` text NOT NULL,
	`secondary_muscles` text NOT NULL,
	`equipment` text NOT NULL,
	`mechanic` text,
	`unilateral` integer NOT NULL,
	`progression_model` text,
	`increment` text,
	`rep_min` integer,
	`rep_max` integer,
	`stress_tags` text NOT NULL,
	`substitution_group` text,
	`instructions` text NOT NULL,
	`cues` text NOT NULL,
	`common_mistakes` text NOT NULL,
	`media` text NOT NULL,
	`source` text NOT NULL,
	`license` text NOT NULL,
	`source_id` text
);
--> statement-breakpoint
CREATE INDEX `exercise_server_seq_idx` ON `exercise` (`server_seq`);--> statement-breakpoint
CREATE INDEX `exercise_substitution_group_idx` ON `exercise` (`substitution_group`);--> statement-breakpoint
CREATE TABLE `op_receipt` (
	`op_id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan_override` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`kind` text NOT NULL,
	`planned_session_id` text,
	`week_id` text,
	`data` text NOT NULL,
	`op_id` text NOT NULL,
	`superseded_at` integer
);
--> statement-breakpoint
CREATE INDEX `plan_override_server_seq_idx` ON `plan_override` (`server_seq`);--> statement-breakpoint
CREATE INDEX `plan_override_planned_session_id_idx` ON `plan_override` (`planned_session_id`);--> statement-breakpoint
CREATE INDEX `plan_override_week_id_idx` ON `plan_override` (`week_id`);--> statement-breakpoint
CREATE TABLE `planned_item` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`planned_session_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`exercise_id` text,
	`targets` text NOT NULL,
	`reasons` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `planned_item_server_seq_idx` ON `planned_item` (`server_seq`);--> statement-breakpoint
CREATE INDEX `planned_item_planned_session_id_idx` ON `planned_item` (`planned_session_id`);--> statement-breakpoint
CREATE TABLE `planned_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`week_id` text,
	`date` text NOT NULL,
	`slot` text NOT NULL,
	`modality` text NOT NULL,
	`workout_type` text NOT NULL,
	`template_id` text,
	`intent` text NOT NULL,
	`status` text NOT NULL,
	`generated_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `planned_session_server_seq_idx` ON `planned_session` (`server_seq`);--> statement-breakpoint
CREATE INDEX `planned_session_week_id_idx` ON `planned_session` (`week_id`);--> statement-breakpoint
CREATE INDEX `planned_session_date_idx` ON `planned_session` (`date`);--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`name` text NOT NULL,
	`grade` text NOT NULL,
	`status` text NOT NULL,
	`sent_at` integer,
	`notes` text
);
--> statement-breakpoint
CREATE INDEX `project_server_seq_idx` ON `project` (`server_seq`);--> statement-breakpoint
CREATE TABLE `run_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`session_log_id` text NOT NULL,
	`workout_type` text NOT NULL,
	`distance_value` real,
	`distance_unit` text NOT NULL,
	`duration_sec` integer,
	`avg_hr` integer,
	`elevation_value` real,
	`elevation_unit` text,
	`rpe` integer,
	`splits` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `run_log_server_seq_idx` ON `run_log` (`server_seq`);--> statement-breakpoint
CREATE INDEX `run_log_session_log_id_idx` ON `run_log` (`session_log_id`);--> statement-breakpoint
CREATE TABLE `session_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`planned_session_id` text,
	`modality` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`local_date` text NOT NULL,
	`timezone` text NOT NULL,
	`rpe` integer,
	`notes` text
);
--> statement-breakpoint
CREATE INDEX `session_log_server_seq_idx` ON `session_log` (`server_seq`);--> statement-breakpoint
CREATE INDEX `session_log_planned_session_id_idx` ON `session_log` (`planned_session_id`);--> statement-breakpoint
CREATE INDEX `session_log_local_date_idx` ON `session_log` (`local_date`);--> statement-breakpoint
CREATE TABLE `set_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`session_log_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`index` integer NOT NULL,
	`load_value` real,
	`load_unit` text,
	`band` text,
	`reps` integer NOT NULL,
	`rir` integer,
	`is_warmup` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `set_log_server_seq_idx` ON `set_log` (`server_seq`);--> statement-breakpoint
CREATE INDEX `set_log_session_log_id_idx` ON `set_log` (`session_log_id`);--> statement-breakpoint
CREATE INDEX `set_log_exercise_id_idx` ON `set_log` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`weight_unit` text NOT NULL,
	`distance_unit` text NOT NULL,
	`timezone` text NOT NULL,
	`equipment` text NOT NULL,
	`availability` text NOT NULL,
	`long_run_day` integer,
	`lift_free_day` integer,
	`goals` text NOT NULL,
	`engine_config` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `settings_server_seq_idx` ON `settings` (`server_seq`);--> statement-breakpoint
CREATE TABLE `template` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`name` text NOT NULL,
	`modality` text NOT NULL,
	`intensity_class` text NOT NULL,
	`intent` text NOT NULL,
	`slots` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `template_server_seq_idx` ON `template` (`server_seq`);--> statement-breakpoint
CREATE TABLE `week` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	`block_id` text NOT NULL,
	`index` integer NOT NULL,
	`start_date` text NOT NULL,
	`type` text NOT NULL,
	`engine_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `week_server_seq_idx` ON `week` (`server_seq`);--> statement-breakpoint
CREATE INDEX `week_block_id_idx` ON `week` (`block_id`);--> statement-breakpoint
CREATE INDEX `week_start_date_idx` ON `week` (`start_date`);