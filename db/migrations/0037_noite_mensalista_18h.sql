-- Pedido do Bryan: a noite do mensalista começa às 18:00 (estava 17:30 no
-- painel). A partir daí o mensalista não marca pelo site, nem pagando.
-- Continua editável em Ajustes → Mensalistas.
UPDATE `settings` SET `member_night_from` = 1080 WHERE `id` = 1;
