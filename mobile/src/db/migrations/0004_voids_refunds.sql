CREATE TABLE `local_refunds` (
	`ulid` text PRIMARY KEY NOT NULL,
	`order_ulid` text NOT NULL,
	`shift_ulid` text NOT NULL,
	`refund_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `local_refunds_shift_ulid_index` ON `local_refunds` (`shift_ulid`);--> statement-breakpoint
CREATE INDEX `local_refunds_order_ulid_index` ON `local_refunds` (`order_ulid`);