CREATE TABLE `recipe_status_cache` (
	`product_id` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`server_time` text NOT NULL
);
