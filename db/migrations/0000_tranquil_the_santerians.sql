CREATE TYPE "public"."appt_kind" AS ENUM('AVULSO', 'ASSINANTE');--> statement-breakpoint
CREATE TYPE "public"."appt_status" AS ENUM('PENDENTE', 'CONFIRMADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'BARBER', 'CLIENT');--> statement-breakpoint
CREATE TYPE "public"."sub_cycle" AS ENUM('MENSAL', 'ANUAL');--> statement-breakpoint
CREATE TYPE "public"."sub_status" AS ENUM('ATIVA', 'CANCELADA', 'INADIMPLENTE');--> statement-breakpoint
CREATE TABLE "appointment_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"appointment_id" integer NOT NULL,
	"service_id" integer,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"duration_min" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"client_user_id" integer,
	"client_name" text NOT NULL,
	"client_phone" text NOT NULL,
	"barber_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"status" "appt_status" DEFAULT 'CONFIRMADO' NOT NULL,
	"kind" "appt_kind" DEFAULT 'AVULSO' NOT NULL,
	"subscription_id" integer,
	"notes" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "barbers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"slug" text NOT NULL,
	"short_name" text NOT NULL,
	"title" text NOT NULL,
	"rating" integer DEFAULT 50 NOT NULL,
	"commission_pct" integer DEFAULT 40 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "barbers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "plan_services" (
	"plan_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	CONSTRAINT "plan_services_plan_id_service_id_pk" PRIMARY KEY("plan_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kicker" text DEFAULT '' NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"price_cents" integer NOT NULL,
	"annual_price_cents" integer NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"highlight" boolean DEFAULT false NOT NULL,
	"badge" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "schedule_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"barber_id" integer,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_cents" integer NOT NULL,
	"duration_min" integer NOT NULL,
	"tag" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "services_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"accepting_bookings" boolean DEFAULT true NOT NULL,
	"min_advance_hours" integer DEFAULT 2 NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"open_minute" integer DEFAULT 540 NOT NULL,
	"close_minute" integer DEFAULT 1200 NOT NULL,
	"closed_weekdays" jsonb DEFAULT '[0,1]'::jsonb NOT NULL,
	"max_advance_days" integer DEFAULT 60 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"status" "sub_status" DEFAULT 'ATIVA' NOT NULL,
	"cycle" "sub_cycle" DEFAULT 'MENSAL' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"renews_at" timestamp with time zone NOT NULL,
	"canceled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"password_hash" text,
	"role" "role" DEFAULT 'CLIENT' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barbers" ADD CONSTRAINT "barbers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_services" ADD CONSTRAINT "plan_services_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_services" ADD CONSTRAINT "plan_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_barber_start_idx" ON "appointments" USING btree ("barber_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_client_idx" ON "appointments" USING btree ("client_user_id");--> statement-breakpoint
CREATE INDEX "appointments_phone_idx" ON "appointments" USING btree ("client_phone");--> statement-breakpoint
CREATE INDEX "schedule_blocks_range_idx" ON "schedule_blocks" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_idx" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");