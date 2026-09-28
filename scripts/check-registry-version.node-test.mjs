import assert from "node:assert/strict";
import test from "node:test";
import { classifyRegistryLookup } from "./check-registry-version.mjs";

test("accepts an existing package only when integrity matches", () => {
  assert.equal(classifyRegistryLookup({ status: 0, stdout: '"sha512-reviewed"' }, "sha512-reviewed"), true);
  assert.throws(
    () => classifyRegistryLookup({ status: 0, stdout: '"sha512-other"' }, "sha512-reviewed"),
    /does not match/,
  );
});

test("permits only an explicit E404 as an unpublished version", () => {
  assert.equal(classifyRegistryLookup({ status: 1, stderr: "npm error code E404" }, "sha512-reviewed"), false);
  assert.throws(
    () => classifyRegistryLookup({ status: 1, stderr: "ECONNRESET" }, "sha512-reviewed"),
    /without an explicit E404/,
  );
});

test("fails closed on malformed registry output", () => {
  assert.throws(
    () => classifyRegistryLookup({ status: 0, stdout: "not-json" }, "sha512-reviewed"),
    /malformed/,
  );
});
