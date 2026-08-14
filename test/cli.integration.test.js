import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ASSET_URL =
  "https://github.com/user-attachments/assets/9a34c7bd-6b09-430a-a1f4-335bf67e4a34";
const MARKDOWN = `<video src="${ASSET_URL}" controls></video>`;
const AUTH_VALUE = "fixture-credential";
const preload = pathToFileURL(resolve("test/fixtures/mock-fetch.mjs")).href;
const cli = resolve("dist/cli.js");

async function runCli(t, options) {
  const directory = await mkdtemp(join(tmpdir(), "gh-video-attach-cli-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "clip.mp4");
  await writeFile(filePath, Buffer.from("video-bytes"));

  return spawnSync(
    process.execPath,
    ["--import", preload, cli, filePath, "--repo", "owner/repo", ...options],
    {
      encoding: "utf8",
      env: {
        PATH: directory,
        GH_TOKEN: AUTH_VALUE,
      },
    },
  );
}

for (const { label, options, failure } of [
  {
    label: "commenting",
    options: ["--issue", "7"],
    failure: /could not complete the comment \(HTTP 503\)/,
  },
  {
    label: "appending to the body",
    options: ["--issue", "7", "--append-body"],
    failure: /could not complete the body update \(HTTP 503\)/,
  },
]) {
  test(`CLI returns uploaded Markdown on stdout when ${label} partially fails`, async (t) => {
    // Act
    const result = await runCli(t, options);

    // Assert
    assert.equal(result.status, 1);
    assert.equal(result.stdout, `${MARKDOWN}\n`);
    assert.match(result.stderr, failure);
    assert.doesNotMatch(result.stdout, new RegExp(AUTH_VALUE));
    assert.doesNotMatch(result.stderr, new RegExp(AUTH_VALUE));
  });
}

test("CLI prints the pull request URL after appending to its body", async (t) => {
  // Act
  const result = await runCli(t, ["--pr", "8", "--append-body"]);

  // Assert
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "https://github.com/owner/repo/pull/8\n");
  assert.equal(result.stderr, "");
});

test("CLI refuses to append to an issue body when --pr was given", async (t) => {
  // Act
  const result = await runCli(t, ["--pr", "7", "--append-body"]);

  // Assert
  assert.equal(result.status, 1);
  assert.equal(result.stdout, `${MARKDOWN}\n`);
  assert.match(result.stderr, /#7 is an issue/);
});
