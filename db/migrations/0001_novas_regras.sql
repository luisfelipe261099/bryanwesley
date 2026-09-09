CREATE TYPE "public"."notif_channel" AS ENUM('WHATSAPP', 'SMS', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."notif_kind" AS ENUM('AGENDAMENTO_CRIADO', 'LEMBRETE_24H', 'LEMBRETE_2H', 'AGENDAMENTO_CANCELADO', 'AGENDAMENTO_REMARCADO', 'ASSINATURA_RENOVADA', 'ASSINATURA_FALHOU');--> statement-breakpoint
CREATE TYPE "public"."notif_status" AS ENUM('PENDENTE', 'ENVIADA', 'ERRO', 'CANCELADA');--> statement-breakpoint
CREATE TABLE "appointment_commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"appointment_id" integer NOT NULL,
	"barber_id" integer NOT NULL,
	"base_cents" integer NOT NULL,
	"barber_pct" integer NOT NULL,
	"barber_cents" integer NOT NULL,
	"shop_cents" integer NOT NULL,
	"from_subscription" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "barber_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"barber_id" integer NOT NULL,
	"weekday" integer NOT NULL,
	"open_minute" integer NOT NULL,
	"close_minute" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"barber_id" integer,
	"min_revenue_cents" integer DEFAULT 0 NOT NULL,
	"barber_pct" integer NOT NULL,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"appointment_id" integer,
	"phone" text NOT NULL,
	"kind" "notif_kind" NOT NULL,
	"channel" "notif_channel" DEFAULT 'WHATSAPP' NOT NULL,
	"body" text NOT NULL,
	"status" "notif_status" DEFAULT 'PENDENTE' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"barber_id" integer NOT NULL,
	"frequency" text DEFAULT 'SEMANAL' NOT NULL,
	"weekday" integer,
	"day_of_month" integer,
	"minutes_of_day" integer NOT NULL,
	"service_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"starts_on" text NOT NULL,
	"ends_on" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "checkin_token" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "checked_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "barber_pct_snapshot" integer;--> statement-breakpoint
ALTER TABLE "appointment_commissions" ADD CONSTRAINT "appointment_commissions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_commissions" ADD CONSTRAINT "appointment_commissions_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_hours" ADD CONSTRAINT "barber_hours_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_tiers" ADD CONSTRAINT "commission_tiers_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_slots" ADD CONSTRAINT "recurring_slots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_slots" ADD CONSTRAINT "recurring_slots_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_commissions_appt_idx" ON "appointment_commissions" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "appointment_commissions_barber_idx" ON "appointment_commissions" USING btree ("barber_id");--> statement-breakpoint
CREATE UNIQUE INDEX "barber_hours_barber_weekday_idx" ON "barber_hours" USING btree ("barber_id","weekday");--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "recurring_slots_user_idx" ON "recurring_slots" USING btree ("user_id");