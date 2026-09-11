CREATE TABLE `appointment_commissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`appointment_id` int NOT NULL,
	`barber_id` int NOT NULL,
	`base_cents` int NOT NULL,
	`barber_pct` int NOT NULL,
	`barber_cents` int NOT NULL,
	`shop_cents` int NOT NULL,
	`from_subscription` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `appointment_commissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `appointment_commissions_appt_idx` UNIQUE(`appointment_id`)
);
--> statement-breakpoint
CREATE TABLE `appointment_services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`appointment_id` int NOT NULL,
	`service_id` int,
	`name` varchar(120) NOT NULL,
	`price_cents` int NOT NULL,
	`duration_min` int NOT NULL,
	CONSTRAINT `appointment_services_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(8) NOT NULL,
	`client_user_id` int,
	`client_name` varchar(120) NOT NULL,
	`client_phone` varchar(20) NOT NULL,
	`barber_id` int NOT NULL,
	`starts_at` datetime(3) NOT NULL,
	`ends_at` datetime(3) NOT NULL,
	`duration_min` int NOT NULL,
	`total_cents` int NOT NULL DEFAULT 0,
	`status` enum('PENDENTE','CONFIRMADO','EM_ANDAMENTO','CONCLUIDO','CANCELADO','NO_SHOW') NOT NULL DEFAULT 'CONFIRMADO',
	`kind` enum('AVULSO','ASSINANTE') NOT NULL DEFAULT 'AVULSO',
	`subscription_id` int,
	`notes` text,
	`checkin_token` varchar(40),
	`checked_in_at` datetime(3),
	`barber_pct_snapshot` int,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `appointments_id` PRIMARY KEY(`id`),
	CONSTRAINT `appointments_code_unique` UNIQUE(`code`),
	CONSTRAINT `appointments_checkin_token_idx` UNIQUE(`checkin_token`)
);
--> statement-breakpoint
CREATE TABLE `barber_hours` (
	`id` int AUTO_INCREMENT NOT NULL,
	`barber_id` int NOT NULL,
	`weekday` int NOT NULL,
	`open_minute` int NOT NULL,
	`close_minute` int NOT NULL,
	CONSTRAINT `barber_hours_id` PRIMARY KEY(`id`),
	CONSTRAINT `barber_hours_barber_weekday_idx` UNIQUE(`barber_id`,`weekday`)
);
--> statement-breakpoint
CREATE TABLE `barbers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`slug` varchar(80) NOT NULL,
	`short_name` varchar(60) NOT NULL,
	`title` varchar(120) NOT NULL,
	`rating` int NOT NULL DEFAULT 50,
	`commission_pct` int NOT NULL DEFAULT 40,
	`monthly_goal_cents` int NOT NULL DEFAULT 700000,
	`active` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `barbers_id` PRIMARY KEY(`id`),
	CONSTRAINT `barbers_slug_idx` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `booking_locks` (
	`barber_id` int NOT NULL,
	`date_key` varchar(10) NOT NULL,
	CONSTRAINT `booking_locks_barber_id_date_key_pk` PRIMARY KEY(`barber_id`,`date_key`)
);
--> statement-breakpoint
CREATE TABLE `commission_tiers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`barber_id` int,
	`min_revenue_cents` int NOT NULL DEFAULT 0,
	`barber_pct` int NOT NULL,
	`label` varchar(60),
	CONSTRAINT `commission_tiers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`appointment_id` int,
	`phone` varchar(20) NOT NULL,
	`kind` enum('AGENDAMENTO_CRIADO','LEMBRETE_24H','LEMBRETE_2H','AGENDAMENTO_CANCELADO','AGENDAMENTO_REMARCADO','ASSINATURA_RENOVADA','ASSINATURA_FALHOU') NOT NULL,
	`channel` enum('WHATSAPP','SMS','EMAIL') NOT NULL DEFAULT 'WHATSAPP',
	`body` text NOT NULL,
	`status` enum('PENDENTE','ENVIADA','ERRO','CANCELADA') NOT NULL DEFAULT 'PENDENTE',
	`scheduled_for` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`sent_at` datetime(3),
	`attempts` int NOT NULL DEFAULT 0,
	`error` varchar(500),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `plan_services` (
	`plan_id` int NOT NULL,
	`service_id` int NOT NULL,
	CONSTRAINT `plan_services_plan_id_service_id_pk` PRIMARY KEY(`plan_id`,`service_id`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(80) NOT NULL,
	`name` varchar(120) NOT NULL,
	`kicker` varchar(60) NOT NULL DEFAULT '',
	`tagline` varchar(160) NOT NULL DEFAULT '',
	`price_cents` int NOT NULL,
	`annual_price_cents` int NOT NULL,
	`features` json NOT NULL,
	`highlight` boolean NOT NULL DEFAULT false,
	`badge` varchar(40),
	`active` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `plans_slug_idx` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `recurring_slots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`barber_id` int NOT NULL,
	`frequency` varchar(10) NOT NULL DEFAULT 'SEMANAL',
	`weekday` int,
	`day_of_month` int,
	`minutes_of_day` int NOT NULL,
	`service_ids` json NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`starts_on` varchar(10) NOT NULL,
	`ends_on` varchar(10),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `recurring_slots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `schedule_blocks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`barber_id` int,
	`starts_at` datetime(3) NOT NULL,
	`ends_at` datetime(3) NOT NULL,
	`reason` varchar(160),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `schedule_blocks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(80) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` varchar(255) NOT NULL DEFAULT '',
	`price_cents` int NOT NULL,
	`duration_min` int NOT NULL,
	`tag` varchar(40),
	`active` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `services_id` PRIMARY KEY(`id`),
	CONSTRAINT `services_slug_idx` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` int NOT NULL DEFAULT 1,
	`accepting_bookings` boolean NOT NULL DEFAULT true,
	`min_advance_hours` int NOT NULL DEFAULT 2,
	`slot_minutes` int NOT NULL DEFAULT 30,
	`open_minute` int NOT NULL DEFAULT 540,
	`close_minute` int NOT NULL DEFAULT 1200,
	`closed_weekdays` json NOT NULL,
	`max_advance_days` int NOT NULL DEFAULT 60,
	`default_barber_pct` int NOT NULL DEFAULT 50,
	`subscription_commission_base` varchar(20) NOT NULL DEFAULT 'PRECO_TABELA',
	`shop_name` varchar(120) NOT NULL DEFAULT 'Bryan Wesley Barbearia',
	`shop_phone` varchar(20) NOT NULL DEFAULT '',
	CONSTRAINT `settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`plan_id` int NOT NULL,
	`status` enum('ATIVA','CANCELADA','INADIMPLENTE') NOT NULL DEFAULT 'ATIVA',
	`cycle` enum('MENSAL','ANUAL') NOT NULL DEFAULT 'MENSAL',
	`started_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`renews_at` datetime(3) NOT NULL,
	`canceled_at` datetime(3),
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`email` varchar(190),
	`password_hash` varchar(100),
	`role` enum('ADMIN','BARBER','CLIENT') NOT NULL DEFAULT 'CLIENT',
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_phone_idx` UNIQUE(`phone`),
	CONSTRAINT `users_email_idx` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `appointment_commissions` ADD CONSTRAINT `appointment_commissions_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointment_commissions` ADD CONSTRAINT `appointment_commissions_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointment_services` ADD CONSTRAINT `appointment_services_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointment_services` ADD CONSTRAINT `appointment_services_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_client_user_id_users_id_fk` FOREIGN KEY (`client_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_subscription_id_subscriptions_id_fk` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `barber_hours` ADD CONSTRAINT `barber_hours_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `barbers` ADD CONSTRAINT `barbers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `booking_locks` ADD CONSTRAINT `booking_locks_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `commission_tiers` ADD CONSTRAINT `commission_tiers_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_appointment_id_appointments_id_fk` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `plan_services` ADD CONSTRAINT `plan_services_plan_id_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `plan_services` ADD CONSTRAINT `plan_services_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_slots` ADD CONSTRAINT `recurring_slots_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_slots` ADD CONSTRAINT `recurring_slots_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `schedule_blocks` ADD CONSTRAINT `schedule_blocks_barber_id_barbers_id_fk` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_plan_id_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `appointment_commissions_barber_idx` ON `appointment_commissions` (`barber_id`);--> statement-breakpoint
CREATE INDEX `appointments_barber_start_idx` ON `appointments` (`barber_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_client_idx` ON `appointments` (`client_user_id`);--> statement-breakpoint
CREATE INDEX `appointments_phone_idx` ON `appointments` (`client_phone`);--> statement-breakpoint
CREATE INDEX `notifications_pending_idx` ON `notifications` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `recurring_slots_user_idx` ON `recurring_slots` (`user_id`);--> statement-breakpoint
CREATE INDEX `schedule_blocks_range_idx` ON `schedule_blocks` (`starts_at`);--> statement-breakpoint
CREATE INDEX `subscriptions_user_idx` ON `subscriptions` (`user_id`);