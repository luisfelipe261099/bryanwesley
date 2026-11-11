-- Pedido do Bryan: no atendimento de assinante, a comissão sai do rateio
-- da mensalidade (valor do plano ÷ atendimentos do mês), não do preço de
-- tabela do serviço. Muda no painel em Ajustes → Mensalistas.
UPDATE `settings` SET `subscription_commission_base` = 'RATEIO' WHERE `id` = 1;
