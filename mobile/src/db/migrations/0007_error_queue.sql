CREATE TABLE `error_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ulid` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `error_queue_ulid_unique` ON `error_queue` (`ulid`);