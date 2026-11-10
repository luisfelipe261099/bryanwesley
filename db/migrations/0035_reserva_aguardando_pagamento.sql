-- Marcado pelo site para outro dia e ainda não pago: é só uma reserva.
-- Não aparece na agenda nem ocupa a cadeira; vira CONFIRMADO quando o
-- pagamento cai (e é liberada se não cair no prazo).
ALTER TABLE `appointments` MODIFY COLUMN `status` enum('PENDENTE','CONFIRMADO','EM_ANDAMENTO','CONCLUIDO','CANCELADO','NO_SHOW','AGUARDANDO_PAGAMENTO') NOT NULL DEFAULT 'CONFIRMADO';
