import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const tokenModuleUrl = pathToFileURL(resolve("dist/token.js")).href;
const runner = `
  import { resolveToken } from ${JSON.stringify(tokenModuleUrl)};
  try {
    const explicit = process.env["EXPLICIT_PRESENT"] === "yes"
      ? process.env["EXPLICIT_VALUE"]
      : undefined;
    process.stdout.write(JSON.stringify({ ok: true, value: resolveToken(explicit) }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      name: error?.name,
      kind: error?.kind,
      message: error?.message,
      causeName: error?.cause?.name,
    }));
  }
`;

async function isolatedTokenEnvironment(
  t,
  { fakeGh = true, ghMode = "success", ghValue = "gh-cli-value" } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "gh-video-attach-token-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, "gh-was-called");

  if (fakeGh) {
    const executable = join(directory, "gh");
    await writeFile(
      executable,
      `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\n` +
        (ghMode === "fail"
          ? "exit 1\n"
          : `printf "%s\\n" ${JSON.stringify(ghValue)}\n`),
    );
    await chmod(executable, 0o700);
  }

  return { directory, marker };
}

function runResolve(environment) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", runner], {
    encoding: "utf8",
    env: environment,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

async function assertMarker(marker, expected) {
  let exists = true;
  try {
    await access(marker, constants.F_OK);
  } catch {
    exists = false;
  }
  assert.equal(exists, expected);
}

test("resolveToken prefers a non-empty explicit value over both environments and gh", async (t) => {
  // Arrange
  const { directory, marker } = await isolatedTokenEnvironment(t);

  // Act
  const result = runResolve({
    PATH: directory,
    EXPLICIT_PRESENT: "yes",
    EXPLICIT_VALUE: "  explicit-value  ",
    GH_TOKEN: "gh-environment-value",
    GITHUB_TOKEN: "github-environment-value",
  });

  // Assert
  assert.deepEqual(result, { ok: true, value: "explicit-value" });
  await assertMarker(marker, false);
});

test("resolveToken prefers GH_TOKEN over GITHUB_TOKEN and gh", async (t) => {
  // Arrange
  const { directory, marker } = await isolatedTokenEnvironment(t);

  // Act
  const result = runResolve({
    PATH: directory,
    GH_TOKEN: "  gh-environment-value  ",
    GITHUB_TOKEN: "github-environment-value",
  });

  // Assert
  assert.deepEqual(result, { ok: true, value: "gh-environment-value" });
  await assertMarker(marker, false);
});

test("resolveToken ignores a blank GH_TOKEN and uses GITHUB_TOKEN", async (t) => {
  // Arrange
  const { directory, marker } = await isolatedTokenEnvironment(t);

  // Act
  const result = runResolve({
    PATH: directory,
    GH_TOKEN: "   ",
    GITHUB_TOKEN: "  github-environment-value  ",
  });

  // Assert
  assert.deepEqual(result, { ok: true, value: "github-environment-value" });
  await assertMarker(marker, false);
});

test("resolveToken uses gh only when no explicit or environment value exists", async (t) => {
  // Arrange
  const { directory, marker } = await isolatedTokenEnvironment(t);

  // Act
  const result = runResolve({ PATH: directory });

  // Assert
  assert.deepEqual(result, { ok: true, value: "gh-cli-value" });
  await assertMarker(marker, true);
});

test("resolveToken rejects an explicitly blank value instead of falling back", async (t) => {
  // Arrange
  const { directory, marker } = await isolatedTokenEnvironment(t);

  // Act
  const result = runResolve({
    PATH: directory,
    EXPLICIT_PRESENT: "yes",
    EXPLICIT_VALUE: "   ",
    GH_TOKEN: "gh-environment-value",
    GITHUB_TOKEN: "github-environment-value",
  });

  // Assert
  assert.equal(result.ok, false);
  assert.equal(result.name, "GitHubAttachError");
  assert.equal(result.kind, "invalid-input");
  await assertMarker(marker, false);
});

test("resolveToken reports auth when no source provides a value without invoking real gh", async (t) => {
  // Arrange: PATH contains no executable named gh, so the machine's real gh cannot run.
  const { directory } = await isolatedTokenEnvironment(t, { fakeGh: false });

  // Act
  const result = runResolve({ PATH: directory });

  // Assert
  assert.equal(result.ok, false);
  assert.equal(result.name, "GitHubAttachError");
  assert.equal(result.kind, "auth");
});

test("resolveToken reports auth when isolated gh fails", async (t) => {
  // Arrange
  const { directory, marker } = await isolatedTokenEnvironment(t, { ghMode: "fail" });

  // Act
  const result = runResolve({ PATH: directory });

  // Assert
  assert.equal(result.ok, false);
  assert.equal(result.name, "GitHubAttachError");
  assert.equal(result.kind, "auth");
  await assertMarker(marker, true);
});
