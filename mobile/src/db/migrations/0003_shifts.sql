CREATE TABLE `cash_movements` (
	`ulid` text PRIMARY KEY NOT NULL,
	`shift_ulid` text NOT NULL,
	`type` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reason` text NOT NULL,
	`occurred_at` text NOT NULL,
	`user_id` integer NOT NULL,
	`user_name` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cash_movements_shift_ulid_index` ON `cash_movements` (`shift_ulid`);--> statement-breakpoint
CREATE TABLE `shifts` (
	`ulid` text PRIMARY KEY NOT NULL,
	`branch_id` integer NOT NULL,
	`status` text NOT NULL,
	`opened_at` text NOT NULL,
	`opened_by_id` integer NOT NULL,
	`opened_by_name` text NOT NULL,
	`opening_float_cents` integer NOT NULL,
	`closed_at` text,
	`closed_by_id` integer,
	`closed_by_name` text,
	`counted_cash_cents` integer,
	`close_note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shifts_branch_status_index` ON `shifts` (`branch_id`,`status`);--> statement-breakpoint
DROP INDEX `print_jobs_first_print_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `print_jobs_first_print_unique` ON `print_jobs` (`order_ulid`,`kind`,`printer_id`,`copy_no`) WHERE is_reprint = 0 AND kind <> 'x_read';--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_local_orders` (
	`ulid` text PRIMARY KEY NOT NULL,
	`order_no` text,
	`order_json` text NOT NULL,
	`status` text NOT NULL,
	`server_order` text,
	`last_error` text,
	`business_date` text NOT NULL,
	`branch_id` integer NOT NULL,
	`cashier_id` integer NOT NULL,
	`shift_ulid` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_local_orders`("ulid", "order_no", "order_json", "status", "server_order", "last_error", "business_date", "branch_id", "cashier_id", "shift_ulid", "created_at", "updated_at") SELECT "ulid", "order_no", "order_json", "status", "server_order", "last_error", "business_date", "branch_id", "cashier_id", NULL, "created_at", "updated_at" FROM `local_orders`;--> statement-breakpoint
DROP TABLE `local_orders`;--> statement-breakpoint
ALTER TABLE `__new_local_orders` RENAME TO `local_orders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `local_orders_status_index` ON `local_orders` (`status`);--> statement-breakpoint
CREATE INDEX `local_orders_business_date_index` ON `local_orders` (`business_date`);--> statement-breakpoint
CREATE INDEX `local_orders_shift_ulid_index` ON `local_orders` (`shift_ulid`);--> statement-breakpoint
ALTER TABLE `outbox` ADD `entity` text DEFAULT 'order' NOT NULL;