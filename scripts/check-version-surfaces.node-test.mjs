import assert from "node:assert/strict";
import test from "node:test";
import { assertVersionSurfaces, REQUIRED_VERSION_SURFACES } from "./check-version-surfaces.mjs";

function matchingSurfaces(version = "0.1.2") {
  return Object.fromEntries(REQUIRED_VERSION_SURFACES.map((surface) => [surface, version]));
}

test("accepts release surfaces that match the package version", () => {
  assert.doesNotThrow(() => assertVersionSurfaces("0.1.2", matchingSurfaces()));
});

test("rejects the exact release surface that drifted", () => {
  assert.throws(
    () => assertVersionSurfaces("0.1.2", { ...matchingSurfaces(), openApi: "0.1.1" }),
    /openApi version 0\.1\.1 does not match package 0\.1\.2/,
  );
});

test("rejects a missing release surface", () => {
  const surfaces = matchingSurfaces();
  delete surfaces.dataset;
  assert.throws(
    () => assertVersionSurfaces("0.1.2", surfaces),
    /version surfaces must include exactly/,
  );
});

test("rejects an empty release surface map", () => {
  assert.throws(() => assertVersionSurfaces("0.1.2", {}), /version surfaces must include exactly/);
});
