CREATE TABLE "documents" (
	"collection" text,
	"id" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "documents_pkey" PRIMARY KEY("collection","id")
);
