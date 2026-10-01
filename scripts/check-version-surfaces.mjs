import assert from "node:assert/strict";

export function assertVersionSurfaces(packageVersion, versionSurfaces) {
  for (const [surface, version] of Object.entries(versionSurfaces)) {
    assert.equal(version, packageVersion, `${surface} version ${version ?? "missing"} does not match package ${packageVersion}`);
  }
}
