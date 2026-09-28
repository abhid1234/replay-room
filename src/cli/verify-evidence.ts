import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { verifyEvidenceBundle, type EvidenceBundle } from "../domain/evidence.js";

export async function verifyEvidenceFile(path: string, secret: string): Promise<boolean> {
  const bundle = JSON.parse(await readFile(path, "utf8")) as EvidenceBundle;
  return verifyEvidenceBundle(bundle, secret);
}

async function main(): Promise<void> {
  const path = process.argv[2];
  const secret = process.env.EVIDENCE_SIGNING_SECRET;
  if (!path || !secret) {
    console.error("Usage: EVIDENCE_SIGNING_SECRET=<secret> npm run evidence:verify -- <bundle.json>");
    process.exitCode = 2;
    return;
  }

  try {
    const valid = await verifyEvidenceFile(path, secret);
    console.log(JSON.stringify({ valid, file: path }));
    if (!valid) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ valid: false, file: path, error: error instanceof Error ? error.message : "Invalid evidence file" }));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
