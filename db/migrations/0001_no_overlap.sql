-- A garantia de "sem dois clientes no mesmo barbeiro e horário" mora aqui,
-- no banco. Mesmo com duas requisições simultâneas, o Postgres rejeita a
-- segunda: nenhuma corrida de aplicação consegue furar isso.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "barber_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE (status <> 'CANCELADO' AND status <> 'NO_SHOW');

-- Um bloqueio nunca pode terminar antes de começar.
ALTER TABLE "schedule_blocks"
  ADD CONSTRAINT "schedule_blocks_valid_range" CHECK ("ends_at" > "starts_at");

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_valid_range" CHECK ("ends_at" > "starts_at");

-- Linha única de configurações.
ALTER TABLE "settings" ADD CONSTRAINT "settings_singleton" CHECK ("id" = 1);
