-- Gold: sai "Barboterapia semanal inclusa" (não combina com o limite de 4
-- atendimentos por mês). Cobre as duas formas de o JSON vir escrito.
UPDATE `plans` SET `features` = REPLACE(`features`, '"Barboterapia semanal inclusa", ', '') WHERE `slug` = 'gold';
--> statement-breakpoint
UPDATE `plans` SET `features` = REPLACE(`features`, '"Barboterapia semanal inclusa",', '') WHERE `slug` = 'gold';
