import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const workflowUrl = new URL("../.github/workflows/publish-huggingface.yml", import.meta.url);

describe("Hugging Face publishing workflow", () => {
  it("is manual, version-gated, and rebuilds both deterministic artifacts", async () => {
    const workflow = await readFile(workflowUrl, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("requested version does not match package.json");
    expect(workflow).toContain("npm run fixtures:check");
    expect(workflow).toContain("npm run space:build");
    expect(workflow).toContain("cmp fixtures/huggingface/dataset-manifest.json");
  });

  it("uses short-lived, repo-scoped OIDC credentials without a stored token", async () => {
    const workflow = await readFile(workflowUrl, "utf8");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("HF_OIDC_RESOURCE: datasets/abhid1234/replay-room-fixtures");
    expect(workflow).toContain("HF_OIDC_RESOURCE: spaces/abhid1234/replay-room");
    expect(workflow).toContain("huggingface_hub==1.19.0");
    expect(workflow).not.toContain("secrets.HF_TOKEN");
    expect(workflow).not.toContain("hf auth login");
  });

  it("keeps dataset and Space publication independently selectable", async () => {
    const workflow = await readFile(workflowUrl, "utf8");

    expect(workflow).toContain("publish_dataset:");
    expect(workflow).toContain("publish_space:");
    expect(workflow.match(/if: \$\{\{ inputs\.publish_dataset \}\}/g)).toHaveLength(2);
    expect(workflow.match(/if: \$\{\{ inputs\.publish_space \}\}/g)).toHaveLength(2);
  });
});
