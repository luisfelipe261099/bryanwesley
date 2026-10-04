CREATE TABLE `push_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`endpoint_hash` char(64) NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` varchar(200) NOT NULL,
	`auth` varchar(100) NOT NULL,
	`aparelho` varchar(200),
	`falhas` int NOT NULL DEFAULT 0,
	`usado_em` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_subscriptions_endpoint_idx` UNIQUE(`endpoint_hash`)
);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);
--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE `push_vapid` (
	`id` int NOT NULL DEFAULT 1,
	`public_key` varchar(120) NOT NULL,
	`private_key` varchar(80) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `push_vapid_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `notifications` MODIFY `channel` enum('WHATSAPP','SMS','EMAIL','PUSH') NOT NULL DEFAULT 'WHATSAPP';
