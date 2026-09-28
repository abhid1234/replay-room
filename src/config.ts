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
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
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
