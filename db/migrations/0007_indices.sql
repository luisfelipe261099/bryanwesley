CREATE INDEX `appointments_start_idx` ON `appointments` (`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_recurring_idx` ON `appointments` (`recurring_slot_id`);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`chave` varchar(80) NOT NULL,
	`hits` int NOT NULL DEFAULT 0,
	`window_start` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `rate_limits_chave` PRIMARY KEY(`chave`)
);
