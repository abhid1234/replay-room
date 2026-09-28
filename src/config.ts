import { z } from "zod";

const DEVELOPMENT_EVIDENCE_SECRET = "development-only-evidence-secret-change-me";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ADMIN_TOKEN: z.string().min(12),
  EVIDENCE_SIGNING_SECRET: z.string().min(32).default(DEVELOPMENT_EVIDENCE_SECRET),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  ALLOW_PRIVATE_TARGETS: z.string().default("false").transform((value) => value === "true"),
  MAX_PAYLOAD_BYTES: z.coerce.number().int().positive().default(262_144),
  INGEST_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().max(100_000).default(600),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  EMBEDDED_WORKER: z.string().default("false").transform((value) => value === "true"),
  RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production" && value.EVIDENCE_SIGNING_SECRET === DEVELOPMENT_EVIDENCE_SECRET) {
    context.addIssue({
      code: "custom",
      path: ["EVIDENCE_SIGNING_SECRET"],
      message: "Production requires a unique evidence signing secret",
    });
  }
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(env);
}
