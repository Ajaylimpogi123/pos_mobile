CREATE TABLE `categories` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sort_order` integer NOT NULL,
	`is_active` integer NOT NULL,
	`image_url` text,
	`image_path` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY NOT NULL,
	`category_id` integer NOT NULL,
	`sku` text,
	`name` text NOT NULL,
	`description` text,
	`price_cents` integer NOT NULL,
	`is_vatable` integer NOT NULL,
	`is_available` integer NOT NULL,
	`track_stock` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`image_url` text,
	`image_path` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `products_category_id_index` ON `products` (`category_id`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`scope` text PRIMARY KEY NOT NULL,
	`cursor` text,
	`api_origin` text,
	`server_time` text
);
