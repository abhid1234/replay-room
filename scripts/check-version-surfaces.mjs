import assert from "node:assert/strict";

export const REQUIRED_VERSION_SURFACES = [
  "dataset",
  "fixtures",
  "openApi",
  "packageLock",
  "packageLockRoot",
  "packageLockWeb",
  "web",
];

export function assertVersionSurfaces(packageVersion, versionSurfaces) {
  assert.deepEqual(
    Object.keys(versionSurfaces).sort(),
    REQUIRED_VERSION_SURFACES,
    `version surfaces must include exactly: ${REQUIRED_VERSION_SURFACES.join(", ")}`,
  );
  for (const [surface, version] of Object.entries(versionSurfaces)) {
    assert.equal(version, packageVersion, `${surface} version ${version ?? "missing"} does not match package ${packageVersion}`);
  }
}
