-- Endereço e Instagram de exemplo que o seed gravava (o telefone já saiu
-- na 0014). Só apaga quando ainda é exatamente o valor de exemplo: o que o
-- dono preencheu em Ajustes fica.
UPDATE `settings` SET `shop_address` = '' WHERE `shop_address` = 'Av. Prefeito Maurício Fruet, 1200 — Cajuru, Curitiba';
--> statement-breakpoint
UPDATE `settings` SET `shop_instagram` = '' WHERE `shop_instagram` = '@bryanwesley.barbearia';
--> statement-breakpoint
UPDATE `settings` SET `shop_phone` = '' WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`shop_phone`, ' ', ''), '(', ''), ')', ''), '-', ''), '+', '') IN ('41999990000', '5541999990000', '041999990000');
