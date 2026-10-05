import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const releaseWorkflowUrl = new URL("../.github/workflows/release.yml", import.meta.url);

describe("release workflow", () => {
  it("uses the supported unified attestation action for provenance and SBOMs", async () => {
    const workflow = await readFile(releaseWorkflowUrl, "utf8");

    expect(workflow.match(/uses: actions\/attest@v4/g)).toHaveLength(2);
    expect(workflow).toContain("subject-path: ${{ steps.pack.outputs.tarball }}");
    expect(workflow).toContain("sbom-path: sbom.cdx.json");
    expect(workflow).toContain("artifact-metadata: write");
    expect(workflow).not.toContain("actions/attest-build-provenance");
    expect(workflow).not.toContain("actions/attest-sbom");
  });

  it("downloads reviewed artifacts with the current runtime generation", async () => {
    const workflow = await readFile(releaseWorkflowUrl, "utf8");

    expect(workflow.match(/uses: actions\/download-artifact@v8/g)).toHaveLength(2);
    expect(workflow).not.toContain("actions/download-artifact@v7");
  });
});
