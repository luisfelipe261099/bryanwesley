CREATE TABLE `whatsapp_ponte` (
	`id` int NOT NULL DEFAULT 1,
	`codigo_hash` varchar(64),
	`codigo_expira` datetime(3),
	`segredo_hash` varchar(64),
	`pareada_em` datetime(3),
	`visto_em` datetime(3),
	`status` varchar(40),
	`numero` varchar(20),
	`nome` varchar(120),
	`qr` mediumtext,
	`codigo_whatsapp` varchar(40),
	`comandos` json,
	`painel_ate` datetime(3),
	`versao` varchar(40),
	CONSTRAINT `whatsapp_ponte_id` PRIMARY KEY(`id`)
);
