CREATE TABLE `game_saves` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`slot` text NOT NULL,
	`revision` integer NOT NULL,
	`document` text,
	`checksum` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_game_saves_project_id` ON `game_saves` (`project_id`);