CREATE TABLE `local_orders` (
	`ulid` text PRIMARY KEY NOT NULL,
	`order_no` text NOT NULL,
	`order_json` text NOT NULL,
	`status` text NOT NULL,
	`server_order` text,
	`last_error` text,
	`business_date` text NOT NULL,
	`branch_id` integer NOT NULL,
	`cashier_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `local_orders_status_index` ON `local_orders` (`status`);--> statement-breakpoint
CREATE INDEX `local_orders_business_date_index` ON `local_orders` (`business_date`);--> statement-breakpoint
CREATE TABLE `order_counters` (
	`device_code` text NOT NULL,
	`business_date` text NOT NULL,
	`last_seq` integer NOT NULL,
	PRIMARY KEY(`device_code`, `business_date`)
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ulid` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer NOT NULL,
	`next_attempt_at` text NOT NULL,
	`status` text NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_ulid_unique` ON `outbox` (`ulid`);--> statement-breakpoint
CREATE INDEX `outbox_status_index` ON `outbox` (`status`);--> statement-breakpoint
CREATE TABLE `stock_cache` (
	`product_id` integer PRIMARY KEY NOT NULL,
	`qty` integer NOT NULL,
	`server_time` text NOT NULL
);
