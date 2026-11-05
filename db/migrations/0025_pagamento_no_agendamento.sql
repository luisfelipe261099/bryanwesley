-- Forma de pagamento escolhida no agendamento: PIX ou CARTAO (online,
-- pelo Asaas) ou BALCAO (paga na barbearia, em dinheiro ou maquininha).
-- Vazio nos horários antigos e nos que o plano cobre.
ALTER TABLE `appointments` ADD `payment_method` varchar(10);
