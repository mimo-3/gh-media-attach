import test from "node:test";
import assert from "node:assert/strict";
import { parseArguments, USAGE } from "../dist/cli-args.js";

test("reads a file and a repository", () => {
  const flags = parseArguments(["demo.mp4", "--repo", "owner/name"]);
  assert.equal(flags.file, "demo.mp4");
  assert.equal(flags.repo, "owner/name");
  assert.equal(flags.issue, undefined);
  assert.equal(flags.urlOnly, false);
  assert.equal(flags.appendBody, false);
});

test("--append-body targets the body of the issue or pull request", () => {
  const issue = parseArguments(["a.mp4", "--repo", "owner/name", "--issue", "7", "--append-body"]);
  assert.equal(issue.appendBody, true);
  assert.equal(issue.issue, 7);
  assert.equal(parseArguments(["a.mp4", "--pr", "42", "--append-body"]).appendBody, true);
});

test("--append-body without a target would silently do nothing", () => {
  assert.throws(
    () => parseArguments(["a.mp4", "--repo", "owner/name", "--append-body"]),
    /--append-body needs --issue or --pr/,
  );
});

test("--pr and --issue fill the same slot", () => {
  assert.equal(parseArguments(["a.mp4", "--pr", "42"]).issue, 42);
  assert.equal(parseArguments(["a.mp4", "--issue", "7"]).issue, 7);
});

test("rejects issue numbers that Number() would silently accept", () => {
  assert.throws(() => parseArguments(["a.mp4", "--issue", "0"]), /positive integer/);
  assert.throws(() => parseArguments(["a.mp4", "--issue", "1e3"]), /positive integer/);
  assert.throws(() => parseArguments(["a.mp4", "--issue", "0x10"]), /positive integer/);
  assert.throws(() => parseArguments(["a.mp4", "--issue", " 12 "]), /positive integer/);
  assert.throws(() => parseArguments(["a.mp4", "--issue", "-3"]), /positive integer/);
  assert.throws(
    () => parseArguments(["a.mp4", "--issue", String(Number.MAX_SAFE_INTEGER + 1)]),
    /safe integer/,
  );
});

test("refuses combinations that would silently drop an intent", () => {
  assert.throws(() => parseArguments(["a.mp4", "--issue", "1", "--pr", "2"]), /not both/);
  assert.throws(() => parseArguments(["a.mp4", "--url", "--issue", "1"]), /pick one/);
  assert.throws(() => parseArguments(["a.mp4", "--append-body", "--url"]), /pick one/);
  assert.throws(() => parseArguments(["a.mp4", "b.mp4"]), /one file/);
});

test("an empty positional argument still counts as the file", () => {
  assert.throws(() => parseArguments(["", "second.mp4"]), /one file/);
});

test("a flag with no value is an error, not a silent undefined", () => {
  assert.throws(() => parseArguments(["a.mp4", "--repo"]), /needs a value/);
  assert.throws(() => parseArguments(["a.mp4", "--name"]), /needs a value/);
});

test("a value-taking option does not swallow the next flag", () => {
  for (const option of ["--repo", "--issue", "--pr", "--content-type", "--name"]) {
    assert.throws(() => parseArguments(["a.mp4", option, "--url"]), /needs a value/);
  }
});

test("singleton options reject duplicates instead of silently overwriting intent", () => {
  assert.throws(
    () => parseArguments(["a.mp4", "--repo", "first/repo", "--repo", "second/repo"]),
    /once|duplicate/,
  );
  assert.throws(
    () => parseArguments(["a.mp4", "--name", "first.mp4", "--name", "second.mp4"]),
    /once|duplicate/,
  );
  assert.throws(() => parseArguments(["a.mp4", "--url", "--url"]), /once|duplicate/);
  assert.throws(
    () => parseArguments(["a.mp4", "--pr", "42", "--append-body", "--append-body"]),
    /once|duplicate/,
  );
});

test("--token is rejected because credentials must not be passed through argv", () => {
  assert.throws(
    () => parseArguments(["a.mp4", "--token", "fixture-value"]),
    /unknown option|no longer supported/,
  );
  assert.doesNotMatch(USAGE, /--token/);
});

test("unknown options are rejected", () => {
  assert.throws(() => parseArguments(["a.mp4", "--nope"]), /unknown option/);
});

test("--help wins without needing a file", () => {
  assert.equal(parseArguments(["--help"]).help, true);
  assert.equal(parseArguments(["-h"]).help, true);
});
