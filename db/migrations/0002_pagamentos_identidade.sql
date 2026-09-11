CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_nsu` varchar(40) NOT NULL,
	`user_id` int,
	`subscription_id` int,
	`appointment_id` int,
	`kind` enum('ASSINATURA','AVULSO') NOT NULL,
	`amount_cents` int NOT NULL,
	`description` varchar(160) NOT NULL,
	`status` enum('PENDENTE','PAGO','EXPIRADO','CANCELADO') NOT NULL DEFAULT 'PENDENTE',
	`provider` varchar(30) NOT NULL DEFAULT 'infinitepay',
	`checkout_url` varchar(500),
	`transaction_nsu` varchar(60),
	`slug` varchar(60),
	`receipt_url` varchar(500),
	`paid_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_order_nsu_idx` UNIQUE(`order_nsu`)
);
--> statement-breakpoint
CREATE TABLE `plan_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`plan_id` int NOT NULL,
	`cycle` enum('MENSAL','ANUAL') NOT NULL DEFAULT 'MENSAL',
	`status` enum('ABERTA','ATENDIDA','RECUSADA') NOT NULL DEFAULT 'ABERTA',
	`note` varchar(300),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `plan_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `settings` ADD `shop_unit` varchar(80) DEFAULT 'Unidade Cajuru' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `shop_address` varchar(200) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `shop_instagram` varchar(80) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `shop_hours_label` varchar(80) DEFAULT 'Ter — Sáb · 09h às 20h' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_subscription_id_subscriptions_id_fk` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `plan_requests` ADD CONSTRAINT `plan_requests_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `plan_requests` ADD CONSTRAINT `plan_requests_plan_id_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `payments_user_idx` ON `payments` (`user_id`);--> statement-breakpoint
CREATE INDEX `plan_requests_user_idx` ON `plan_requests` (`user_id`);