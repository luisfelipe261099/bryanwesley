CREATE TABLE "booking_locks" (
	"barber_id" integer NOT NULL,
	"date_key" text NOT NULL,
	CONSTRAINT "booking_locks_barber_id_date_key_pk" PRIMARY KEY("barber_id","date_key")
);
--> statement-breakpoint
ALTER TABLE "barbers" ADD COLUMN "monthly_goal_cents" integer DEFAULT 700000 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_locks" ADD CONSTRAINT "booking_locks_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE cascade ON UPDATE no action;