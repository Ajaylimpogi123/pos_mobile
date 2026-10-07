CREATE TABLE `print_config` (
	`api_origin` text NOT NULL,
	`branch_id` integer NOT NULL,
	`payload` text NOT NULL,
	`generated_at` text NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`api_origin`, `branch_id`)
);
--> statement-breakpoint
CREATE TABLE `print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`order_ulid` text NOT NULL,
	`queue_no` integer NOT NULL,
	`kind` text NOT NULL,
	`printer_id` integer NOT NULL,
	`printer_name` text NOT NULL,
	`printer_role` text NOT NULL,
	`copy_no` integer NOT NULL,
	`copies` integer NOT NULL,
	`is_reprint` integer NOT NULL,
	`order_json` text NOT NULL,
	`item_ids` text,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`error` text,
	`dismissed` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `print_jobs_first_print_unique` ON `print_jobs` (`order_ulid`,`kind`,`printer_id`,`copy_no`) WHERE is_reprint = 0;--> statement-breakpoint
CREATE INDEX `print_jobs_status_index` ON `print_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `print_jobs_order_ulid_index` ON `print_jobs` (`order_ulid`);