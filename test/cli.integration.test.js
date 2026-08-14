import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ASSET_URL =
  "https://github.com/user-attachments/assets/9a34c7bd-6b09-430a-a1f4-335bf67e4a34";
const AUTH_VALUE = "fixture-credential";
const preload = pathToFileURL(resolve("test/fixtures/mock-fetch.mjs")).href;
const cli = resolve("dist/cli.js");

for (const { label, options, failure } of [
  { label: "commenting", options: [], failure: /comment|503|unavailable/i },
  { label: "appending to the body", options: ["--append-body"], failure: /body|503|unavailable/i },
]) {
  test(`CLI returns uploaded Markdown on stdout when ${label} partially fails`, async (t) => {
    // Arrange
    const directory = await mkdtemp(join(tmpdir(), "gh-video-attach-cli-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const filePath = join(directory, "clip.mp4");
    await writeFile(filePath, Buffer.from("video-bytes"));

    // Act
    const result = spawnSync(
      process.execPath,
      ["--import", preload, cli, filePath, "--repo", "owner/repo", "--issue", "7", ...options],
      {
        encoding: "utf8",
        env: {
          PATH: directory,
          GH_TOKEN: AUTH_VALUE,
        },
      },
    );

    // Assert
    assert.equal(result.status, 1);
    assert.equal(result.stdout, `<video src="${ASSET_URL}" controls></video>\n`);
    assert.match(result.stderr, failure);
    assert.doesNotMatch(result.stdout, new RegExp(AUTH_VALUE));
    assert.doesNotMatch(result.stderr, new RegExp(AUTH_VALUE));
  });
}
