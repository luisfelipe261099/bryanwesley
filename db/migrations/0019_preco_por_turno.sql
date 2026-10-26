-- Preço por turno: o mesmo serviço com outro valor em certos dias e horários
-- (noite, sábado…). Fora de qualquer regra vale o preço do catálogo.
CREATE TABLE `service_price_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`service_id` int NOT NULL,
	`label` varchar(40) NOT NULL DEFAULT '',
	`weekdays` json NOT NULL,
	`start_min` int NOT NULL,
	`end_min` int NOT NULL,
	`price_cents` int NOT NULL,
	CONSTRAINT `service_price_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `service_price_rules_service_idx` ON `service_price_rules` (`service_id`);
--> statement-breakpoint
ALTER TABLE `service_price_rules` ADD CONSTRAINT `service_price_rules_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE cascade ON UPDATE no action;
