-- Plano com limite de atendimentos por mês (4 em todos, a partir de agora)
-- e atendimentos extras que o admin libera para um membro.
ALTER TABLE `plans` ADD `monthly_limit` int;
--> statement-breakpoint
UPDATE `plans` SET `monthly_limit` = 4;
--> statement-breakpoint
ALTER TABLE `users` ADD `extra_visits` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `appointments` ADD `extra_credit` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- A vitrine não pode prometer "ilimitado": troca só os textos originais.
UPDATE `plans` SET `features` = REPLACE(`features`, 'Cortes ilimitados durante todo o mês', 'Até 4 atendimentos por mês');
--> statement-breakpoint
UPDATE `plans` SET `features` = REPLACE(`features`, 'Cortes & barba ilimitados + toalha quente', 'Corte & barba até 4 vezes por mês + toalha quente');
--> statement-breakpoint
UPDATE `plans` SET `tagline` = 'A experiência completa, do jeito que você merece.' WHERE `tagline` = 'A experiência completa, sem limites.';
