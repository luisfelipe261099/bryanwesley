CREATE TABLE `whatsapp_sessions` (
	`phone` varchar(20) NOT NULL,
	`etapa` varchar(20) NOT NULL DEFAULT 'menu',
	`dados` json,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `whatsapp_sessions_phone` PRIMARY KEY(`phone`)
);
