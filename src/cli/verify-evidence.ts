#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseEvidenceBundle, verifyEvidenceBundle } from "../domain/evidence.js";

interface EvidenceSummary {
  validSchema: true;
  schemaVersion: string;
  eventId: string;
  status: string;
  diagnosis: string;
  replayRisk: string;
  attempts: number;
  rehearsals: number;
  auditEntries: number;
  contentSha256: string;
}

export async function verifyEvidenceFile(path: string, secret: string): Promise<boolean> {
  const bundle = parseEvidenceBundle(JSON.parse(await readFile(path, "utf8")));
  return verifyEvidenceBundle(bundle, secret);
}

export async function inspectEvidenceFile(path: string): Promise<EvidenceSummary> {
  const bundle = parseEvidenceBundle(JSON.parse(await readFile(path, "utf8")));
  return {
    validSchema: true,
    schemaVersion: bundle.schemaVersion,
    eventId: bundle.event.id,
    status: bundle.event.status,
    diagnosis: bundle.diagnosis.code,
    replayRisk: bundle.replayRisk.level,
    attempts: bundle.attempts.length,
    rehearsals: bundle.rehearsals.length,
    auditEntries: bundle.audit.length,
    contentSha256: bundle.integrity.contentSha256,
  };
}

const usage = "Usage: replay-room inspect <bundle.json> | EVIDENCE_SIGNING_SECRET=<secret> replay-room verify <bundle.json> | replay-room doctor --api <origin> --site <origin> [--space <origin>]";

interface LiveCheckModule {
  main(args: string[]): Promise<void>;
}

async function runDoctor(args: string[]): Promise<void> {
  const moduleUrl = new URL("../../scripts/check-live-deployment.mjs", import.meta.url);
  const liveCheck = await import(moduleUrl.href) as LiveCheckModule;
  await liveCheck.main(args);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [commandOrPath, commandPath] = args;
  if (commandOrPath === "doctor") {
    await runDoctor(args.slice(1));
    return;
  }
  if (commandOrPath === "--help" || commandOrPath === "help") {
    console.log(usage);
    return;
  }
  const command = commandOrPath === "inspect" ? "inspect" : "verify";
  const path = commandOrPath === "verify" || commandOrPath === "inspect" ? commandPath : commandOrPath;
  const secret = process.env.EVIDENCE_SIGNING_SECRET;
  if (!path || (command === "verify" && !secret)) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }

  try {
    if (command === "inspect") {
      console.log(JSON.stringify({ file: path, ...await inspectEvidenceFile(path) }));
    } else {
      const valid = await verifyEvidenceFile(path, secret!);
      console.log(JSON.stringify({ valid, file: path }));
      if (!valid) process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({ valid: false, file: path, error: error instanceof Error ? error.message : "Invalid evidence file" }));
    process.exitCode = 1;
  }
}

void main();
