-- Agendado pelo site para outro dia: o horário só fica garantido com o
-- pagamento (Pix ou cartão). Sem pagar até este instante, ele é liberado.
ALTER TABLE `appointments` ADD `pay_by` datetime(3);
