CREATE TABLE `author_accounts` (
	`project_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `player_saves` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`slot` text NOT NULL,
	`revision` integer NOT NULL,
	`document` text,
	`checksum` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`, `slot`)
);
--> statement-breakpoint
CREATE TABLE `published_games` (
	`project_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`author_revision` integer NOT NULL,
	`document` text NOT NULL,
	`fingerprint` text NOT NULL,
	`published_at` text NOT NULL
);
