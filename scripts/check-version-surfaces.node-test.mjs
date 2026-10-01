import assert from "node:assert/strict";
import test from "node:test";
import { assertVersionSurfaces } from "./check-version-surfaces.mjs";

test("accepts release surfaces that match the package version", () => {
  assert.doesNotThrow(() => assertVersionSurfaces("0.1.2", { openApi: "0.1.2", fixtures: "0.1.2" }));
});

test("rejects the exact release surface that drifted", () => {
  assert.throws(
    () => assertVersionSurfaces("0.1.2", { openApi: "0.1.1", fixtures: "0.1.2" }),
    /openApi version 0\.1\.1 does not match package 0\.1\.2/,
  );
});

test("rejects a missing release surface", () => {
  assert.throws(
    () => assertVersionSurfaces("0.1.2", { dataset: undefined }),
    /dataset version missing does not match package 0\.1\.2/,
  );
});
