ALTER TABLE "settings" ADD COLUMN "default_barber_pct" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "subscription_commission_base" text DEFAULT 'PRECO_TABELA' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "shop_name" text DEFAULT 'Bryan Wesley Barbearia' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "shop_phone" text DEFAULT '' NOT NULL;