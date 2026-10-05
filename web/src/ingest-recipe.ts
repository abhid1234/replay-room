export type IngestSignatureProfile = "none" | "generic" | "github" | "stripe";

export interface IngestRecipe {
  command: string;
  signatureHeader: string | null;
}

const signatureHeaders: Record<Exclude<IngestSignatureProfile, "none">, string> = {
  generic: "X-Replay-Signature: <sha256-hmac>",
  github: "X-Hub-Signature-256: <sha256-hmac>",
  stripe: "Stripe-Signature: t=<unix>,v1=<sha256-hmac>",
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildIngestRecipe(apiBase: string, ingestKey: string, signatureProfile: IngestSignatureProfile): IngestRecipe {
  const url = new URL(`/ingest/${encodeURIComponent(ingestKey)}`, `${apiBase.replace(/\/$/, "")}/`).href;
  const signatureHeader = signatureProfile === "none" ? null : signatureHeaders[signatureProfile];
  const headers = [
    "Content-Type: application/json",
    "Idempotency-Key: launch-demo-001",
    ...(signatureHeader ? [signatureHeader] : []),
  ];
  const payload = JSON.stringify({ type: "launch.demo", source: "replay-room-console" });
  const lines = [
    `curl --request POST ${shellQuote(url)}`,
    ...headers.map((header) => `  --header ${shellQuote(header)}`),
    `  --data ${shellQuote(payload)}`,
  ];

  return { command: lines.join(" \\\n"), signatureHeader };
}
