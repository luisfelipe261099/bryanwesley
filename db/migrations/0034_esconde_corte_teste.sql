-- O serviço "Corte teste" (R$ 5,00) serviu para testar o Pix de ponta a
-- ponta. Sai do catálogo (fica inativo; nada é apagado e os horários que
-- já usaram continuam como estão).
UPDATE `services` SET `active` = false WHERE `name` = 'Corte teste' AND `price_cents` <= 1000;
