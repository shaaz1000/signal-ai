CREATE TABLE "abuse_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "abuse_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint,
	"ip_hash" text,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abuse_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_flags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "generated_content" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "generated_content_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"content_version" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"variant" text DEFAULT '' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_content" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "generation_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"cost_estimate" real DEFAULT 0 NOT NULL,
	"result_id" bigint,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "generation_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "model_releases" (
	"discovery_id" text PRIMARY KEY NOT NULL,
	"vendor" text,
	"open_weights" boolean,
	"license" text,
	"modalities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"independently_tested" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_releases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trend_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trend_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic_kind" text NOT NULL,
	"topic" text NOT NULL,
	"day" text NOT NULL,
	"items" integer NOT NULL,
	"sources" integer NOT NULL,
	"repos" integer NOT NULL,
	"papers" integer NOT NULL,
	"launches" integer NOT NULL,
	"momentum" real NOT NULL,
	"credibility" real NOT NULL,
	"top_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trend_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"cost" real DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "usage_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "discoveries" ADD COLUMN "industries" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "discoveries" ADD COLUMN "evidence_stage" text;--> statement-breakpoint
ALTER TABLE "discoveries" ADD COLUMN "evidence_stage_cue" text;--> statement-breakpoint
ALTER TABLE "discoveries" ADD COLUMN "concept_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "abuse_events" ADD CONSTRAINT "abuse_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_content" ADD CONSTRAINT "generated_content_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_releases" ADD CONSTRAINT "model_releases_discovery_id_discoveries_id_fk" FOREIGN KEY ("discovery_id") REFERENCES "public"."discoveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abuse_user_idx" ON "abuse_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "abuse_created_idx" ON "abuse_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "generated_identity_uq" ON "generated_content" USING btree ("kind","subject","content_version","language","variant","provider","model");--> statement-breakpoint
CREATE INDEX "generated_subject_idx" ON "generated_content" USING btree ("subject","kind","language");--> statement-breakpoint
CREATE INDEX "generated_created_by_idx" ON "generated_content" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_uq" ON "generation_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_user_status_idx" ON "generation_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "trend_topic_day_uq" ON "trend_snapshots" USING btree ("topic_kind","topic","day");--> statement-breakpoint
CREATE INDEX "trend_day_idx" ON "trend_snapshots" USING btree ("day");--> statement-breakpoint
CREATE INDEX "usage_window_idx" ON "usage_counters" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "users_token_hash_uq" ON "users" USING btree ("token_hash");