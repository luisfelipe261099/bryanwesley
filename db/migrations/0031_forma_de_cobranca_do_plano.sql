-- Como o membro paga a mensalidade quando a cobrança é gerada sozinha:
-- PIX (padrão) ou CARTAO (assinatura do cartão no Asaas, aberta perto
-- do vencimento escolhido pelo admin).
ALTER TABLE `subscriptions` ADD `billing_pref` varchar(10);
