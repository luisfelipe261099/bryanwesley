-- Telefones gravados com o zero de longa distância na frente do DDD,
-- "(041) 9 9999-8888" → 041999998888. A normalização passou a tirar esse
-- zero; sem esta conversão, quem foi gravado assim não entrava mais pelo
-- telefone e ganhava um cadastro duplicado no próximo agendamento.
-- Se o número convertido já é de outra conta, a linha fica como está.
-- Celular antigo sem o nono dígito (0 + DDD + 8 dígitos começando em 6-9)
-- ganha o 9, como na normalização.
UPDATE `users` SET `phone` = SUBSTRING(`phone`, 2)
WHERE `phone` REGEXP '^0[1-9][0-9]{10}$'
  AND SUBSTRING(`phone`, 2) NOT IN (SELECT `p` FROM (SELECT DISTINCT `phone` AS `p` FROM `users`) AS `t`);
--> statement-breakpoint
UPDATE `users` SET `phone` = IF(SUBSTRING(`phone`, 4, 1) IN ('6', '7', '8', '9'), CONCAT(SUBSTRING(`phone`, 2, 2), '9', SUBSTRING(`phone`, 4)), SUBSTRING(`phone`, 2))
WHERE `phone` REGEXP '^0[1-9][0-9]{9}$'
  AND IF(SUBSTRING(`phone`, 4, 1) IN ('6', '7', '8', '9'), CONCAT(SUBSTRING(`phone`, 2, 2), '9', SUBSTRING(`phone`, 4)), SUBSTRING(`phone`, 2))
    NOT IN (SELECT `p` FROM (SELECT DISTINCT `phone` AS `p` FROM `users`) AS `t`);
--> statement-breakpoint
UPDATE `appointments` SET `client_phone` = SUBSTRING(`client_phone`, 2)
WHERE `client_phone` REGEXP '^0[1-9][0-9]{10}$';
--> statement-breakpoint
UPDATE `appointments` SET `client_phone` = IF(SUBSTRING(`client_phone`, 4, 1) IN ('6', '7', '8', '9'), CONCAT(SUBSTRING(`client_phone`, 2, 2), '9', SUBSTRING(`client_phone`, 4)), SUBSTRING(`client_phone`, 2))
WHERE `client_phone` REGEXP '^0[1-9][0-9]{9}$';
--> statement-breakpoint
UPDATE `notifications` SET `phone` = SUBSTRING(`phone`, 2)
WHERE `status` = 'PENDENTE' AND `phone` REGEXP '^0[1-9][0-9]{10}$';
--> statement-breakpoint
UPDATE `notifications` SET `phone` = IF(SUBSTRING(`phone`, 4, 1) IN ('6', '7', '8', '9'), CONCAT(SUBSTRING(`phone`, 2, 2), '9', SUBSTRING(`phone`, 4)), SUBSTRING(`phone`, 2))
WHERE `status` = 'PENDENTE' AND `phone` REGEXP '^0[1-9][0-9]{9}$';
