import { describe, expect, it } from "vitest";
import { buildIngestRecipe } from "../web/src/ingest-recipe.js";

describe("ingest recipe", () => {
  it("builds an executable idempotent recipe for unsigned endpoints", () => {
    const recipe = buildIngestRecipe("https://api.example.com/", "hook_abc-123", "none");

    expect(recipe.signatureHeader).toBeNull();
    expect(recipe.command).toContain("'https://api.example.com/ingest/hook_abc-123'");
    expect(recipe.command).toContain("'Idempotency-Key: launch-demo-001'");
    expect(recipe.command).toContain("'Content-Type: application/json'");
    expect(recipe.command).toContain("'\u007b\"type\":\"launch.demo\",\"source\":\"replay-room-console\"\u007d'");
  });

  it.each([
    ["generic", "X-Replay-Signature: <sha256-hmac>"],
    ["github", "X-Hub-Signature-256: <sha256-hmac>"],
    ["stripe", "Stripe-Signature: t=<unix>,v1=<sha256-hmac>"],
  ] as const)("marks the %s signature that must be computed", (profile, expectedHeader) => {
    const recipe = buildIngestRecipe("https://api.example.com", "hook_signed", profile);

    expect(recipe.signatureHeader).toBe(expectedHeader);
    expect(recipe.command).toContain(`'${expectedHeader}'`);
  });

  it("URL-encodes an ingest capability instead of allowing path injection", () => {
    const recipe = buildIngestRecipe("https://api.example.com", "key/with space", "none");

    expect(recipe.command).toContain("key%2Fwith%20space");
    expect(recipe.command).not.toContain("key/with space");
  });
});
