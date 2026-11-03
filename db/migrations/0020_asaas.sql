-- Pagamentos pelo Asaas: o CPF do cliente (obrigatório para gerar a
-- cobrança lá) e o id do cliente correspondente no Asaas.
ALTER TABLE `users` ADD `cpf` varchar(11);
--> statement-breakpoint
ALTER TABLE `users` ADD `asaas_customer_id` varchar(40);
--> statement-breakpoint
ALTER TABLE `payments` ALTER COLUMN `provider` SET DEFAULT 'asaas';
