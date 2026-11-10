-- Cartão recorrente: a assinatura correspondente no Asaas, que cobra o
-- cartão do membro sozinha a cada ciclo.
ALTER TABLE `subscriptions` ADD `asaas_subscription_id` varchar(40);
