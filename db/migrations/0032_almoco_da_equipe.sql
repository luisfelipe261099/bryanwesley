-- Horário de almoço de cada profissional (minutos do dia; vazio = sem
-- almoço fixo). Todo dia de trabalho dele, esse intervalo fica bloqueado
-- na agenda.
ALTER TABLE `barbers` ADD `lunch_start` int;
--> statement-breakpoint
ALTER TABLE `barbers` ADD `lunch_end` int;
