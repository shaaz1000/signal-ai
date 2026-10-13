CREATE TABLE "bookmarks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bookmarks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"discovery_id" text NOT NULL,
	"collection_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookmarks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "collections" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credibility_assessments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credibility_assessments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"discovery_id" text NOT NULL,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"score" integer NOT NULL,
	"level" text NOT NULL,
	"factors" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credibility_assessments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discoveries" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" bigint NOT NULL,
	"category_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"headline" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"canonical_url" text NOT NULL,
	"author" text,
	"author_verified" boolean DEFAULT false NOT NULL,
	"claim_type" text NOT NULL,
	"execution_mode" text,
	"published_at" timestamp with time zone,
	"first_discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"last_ranked_at" timestamp with time zone,
	"status" text DEFAULT 'candidate' NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"confidence_level" text DEFAULT 'unverified' NOT NULL,
	"editorial" jsonb,
	"score_total" real DEFAULT 0 NOT NULL,
	"score_novelty" real DEFAULT 0 NOT NULL,
	"score_momentum" real DEFAULT 0 NOT NULL,
	"score_significance" real DEFAULT 0 NOT NULL,
	"score_usefulness" real DEFAULT 0 NOT NULL,
	"score_freshness" real DEFAULT 0 NOT NULL,
	"score_gem" real DEFAULT 0 NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"credibility_factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_significance" real,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text DEFAULT 'ingestion' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discoveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_tags" (
	"discovery_id" text NOT NULL,
	"tag_id" bigint NOT NULL,
	CONSTRAINT "discovery_tags_discovery_id_tag_id_pk" PRIMARY KEY("discovery_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "discovery_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "editions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "editions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"period_start" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"featured_id" text,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingestion_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"providers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "ingestion_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"canonical_key" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"owner" text,
	"url" text NOT NULL,
	"homepage_url" text,
	"primary_language" text,
	"license" text,
	"source_created_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ranking_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ranking_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"discovery_id" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"day" text NOT NULL,
	"total" real NOT NULL,
	"novelty" real NOT NULL,
	"momentum" real NOT NULL,
	"significance" real NOT NULL,
	"credibility" real NOT NULL,
	"usefulness" real NOT NULL,
	"freshness" real NOT NULL,
	"weights_version" text NOT NULL,
	"explanation" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ranking_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "repo_metric_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repo_metric_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"bucket" text NOT NULL,
	"stars" integer NOT NULL,
	"forks" integer NOT NULL,
	"open_issues" integer NOT NULL,
	"watchers" integer,
	"contributors" integer,
	"pushed_at" timestamp with time zone,
	"latest_release_tag" text,
	"latest_release_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "repo_metric_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_references" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "source_references_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"discovery_id" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"published_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"points" integer,
	"comments" integer,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_references" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"group" text NOT NULL,
	"reliability" real NOT NULL,
	"owner" text NOT NULL,
	"homepage" text,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tags" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "verification_evidence" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "verification_evidence_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"discovery_id" text NOT NULL,
	"check" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" text NOT NULL,
	"evidence_url" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verification_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_discovery_id_discoveries_id_fk" FOREIGN KEY ("discovery_id") REFERENCES "public"."discoveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credibility_assessments" ADD CONSTRAINT "credibility_assessments_discovery_id_discoveries_id_fk" FOREIGN KEY ("discovery_id") REFERENCES "public"."discoveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discoveries" ADD CONSTRAINT "discoveries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discoveries" ADD CONSTRAINT "discoveries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_tags" ADD CONSTRAINT "discovery_tags_discovery_id_discoveries_id_fk" FOREIGN KEY ("discovery_id") REFERENCES "public"."discoveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_tags" ADD CONSTRAINT "discovery_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_snapshots" ADD CONSTRAINT "ranking_snapshots_discovery_id_discoveries_id_fk" FOREIGN KEY ("discovery_id") REFERENCES "public"."discoveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_metric_snapshots" ADD CONSTRAINT "repo_metric_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_discovery_id_discoveries_id_fk" FOREIGN KEY ("discovery_id") REFERENCES "public"."discoveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_evidence" ADD CONSTRAINT "verification_evidence_discovery_id_discoveries_id_fk" FOREIGN KEY ("discovery_id") REFERENCES "public"."discoveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookmarks_user_discovery_uq" ON "bookmarks" USING btree ("user_id","discovery_id");--> statement-breakpoint
CREATE INDEX "bookmarks_discovery_idx" ON "bookmarks" USING btree ("discovery_id");--> statement-breakpoint
CREATE INDEX "bookmarks_collection_idx" ON "bookmarks" USING btree ("collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_user_name_uq" ON "collections" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "credibility_discovery_idx" ON "credibility_assessments" USING btree ("discovery_id","assessed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "discoveries_project_uq" ON "discoveries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "discoveries_category_idx" ON "discoveries" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "discoveries_feed_idx" ON "discoveries" USING btree ("status","first_discovered_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "discoveries_score_idx" ON "discoveries" USING btree ("score_total" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "discoveries_verify_queue_idx" ON "discoveries" USING btree ("last_verified_at" NULLS FIRST);--> statement-breakpoint
CREATE INDEX "discovery_tags_tag_idx" ON "discovery_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "editions_kind_period_uq" ON "editions" USING btree ("kind","period_start");--> statement-breakpoint
CREATE INDEX "runs_job_started_idx" ON "ingestion_runs" USING btree ("job","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "projects_canonical_key_uq" ON "projects" USING btree ("canonical_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ranking_discovery_day_uq" ON "ranking_snapshots" USING btree ("discovery_id","day");--> statement-breakpoint
CREATE INDEX "ranking_computed_idx" ON "ranking_snapshots" USING btree ("computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_snapshots_project_bucket_uq" ON "repo_metric_snapshots" USING btree ("project_id","bucket");--> statement-breakpoint
CREATE INDEX "repo_snapshots_observed_idx" ON "repo_metric_snapshots" USING btree ("observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_refs_source_external_uq" ON "source_references" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "source_refs_discovery_idx" ON "source_references" USING btree ("discovery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_slug_uq" ON "tags" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_external_uq" ON "users" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_discovery_check_uq" ON "verification_evidence" USING btree ("discovery_id","check");