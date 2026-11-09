-- Mensalista: a partir deste horário (minutos do dia) o plano não cobre;
-- vazio = sem restrição. Padrão 18:00.
ALTER TABLE `settings` ADD `member_night_from` int DEFAULT 1080;
--> statement-breakpoint
UPDATE `settings` SET `member_night_from` = 1080;
--> statement-breakpoint
-- Cobrança automática da mensalidade pelo Asaas (Pix), alguns dias antes
-- do vencimento.
ALTER TABLE `settings` ADD `auto_charge` boolean NOT NULL DEFAULT true;
