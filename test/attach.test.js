import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attach, GitHubAttachError } from "../dist/index.js";

const ASSET_URL =
  "https://github.com/user-attachments/assets/9a34c7bd-6b09-430a-a1f4-335bf67e4a34";
const AUTH_VALUE = "fixture-credential";
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "gh-media-attach-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function temporaryFile(t, name = "clip.mp4", bytes = Buffer.from("video-bytes")) {
  const directory = await temporaryDirectory(t);
  const filePath = join(directory, name);
  await writeFile(filePath, bytes);
  return { filePath, bytes };
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetchSequence(t, responses) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const response = responses[calls.length - 1];
    assert.notEqual(response, undefined, `unexpected fetch #${calls.length}`);
    return typeof response === "function" ? response(input, init) : response;
  });
  return calls;
}

function hasAttachError(kind, status) {
  return (error) => {
    assert.ok(error instanceof GitHubAttachError);
    assert.equal(error.kind, kind);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  };
}

test("attach resolves the repository before uploading with the required request contract", async (t) => {
  // Arrange
  const { filePath, bytes } = await temporaryFile(t);
  const calls = mockFetchSequence(t, [
    jsonResponse({ id: 4242 }, 200),
    jsonResponse({ url: ASSET_URL }, 201),
  ]);

  // Act
  const asset = await attach(filePath, { repo: "owner/repo", token: AUTH_VALUE });

  // Assert
  assert.deepEqual(asset, {
    url: ASSET_URL,
    name: "clip.mp4",
    contentType: "video/mp4",
    size: bytes.byteLength,
  });
  assert.equal(calls.length, 2);

  const lookup = calls[0];
  assert.equal(lookup.url, "https://api.github.com/repos/owner/repo");
  assert.equal(lookup.init.method ?? "GET", "GET");
  const lookupHeaders = new Headers(lookup.init.headers);
  assert.equal(lookupHeaders.get("authorization"), `Bearer ${AUTH_VALUE}`);
  assert.equal(lookupHeaders.get("accept"), "application/vnd.github+json");
  assert.equal(lookupHeaders.get("x-github-api-version"), "2022-11-28");

  const upload = calls[1];
  const uploadUrl = new URL(upload.url);
  assert.equal(uploadUrl.origin, "https://uploads.github.com");
  assert.equal(uploadUrl.pathname, "/user-attachments/assets");
  assert.deepEqual(Object.fromEntries(uploadUrl.searchParams), {
    name: "clip.mp4",
    content_type: "video/mp4",
    repository_id: "4242",
  });
  assert.doesNotMatch(upload.url, new RegExp(AUTH_VALUE));
  assert.equal(upload.init.method, "POST");
  const uploadHeaders = new Headers(upload.init.headers);
  assert.equal(uploadHeaders.get("authorization"), `Bearer ${AUTH_VALUE}`);
  assert.equal(uploadHeaders.get("accept"), "application/json");
  assert.equal(uploadHeaders.get("content-type"), "video/mp4");
  assert.deepEqual(Buffer.from(upload.init.body), bytes);
});

test("attach uploads the opened file even if the path is replaced during repository lookup", async (t) => {
  // Arrange
  const directory = await temporaryDirectory(t);
  const originalPath = join(directory, "original.mp4");
  const replacementPath = join(directory, "replacement.mp4");
  const filePath = join(directory, "clip.mp4");
  const original = Buffer.from("original-video");
  await writeFile(originalPath, original);
  await writeFile(replacementPath, Buffer.from("replacement-secret"));
  await symlink(originalPath, filePath);
  const calls = mockFetchSequence(t, [
    async () => {
      await rm(filePath);
      await symlink(replacementPath, filePath);
      return jsonResponse({ id: 4242 }, 200);
    },
    jsonResponse({ url: ASSET_URL }, 201),
  ]);

  // Act
  await attach(filePath, { repo: "owner/repo", token: AUTH_VALUE });

  // Assert
  assert.deepEqual(Buffer.from(calls[1].init.body), original);
});

for (const [label, body] of [
  ["null", null],
  ["an empty object", {}],
  ["an unrecognised URL", { url: "https://example.com/not-a-github-asset" }],
]) {
  test(`attach classifies a 201 response containing ${label} as endpoint-changed`, async (t) => {
    // Arrange
    const { filePath } = await temporaryFile(t);
    mockFetchSequence(t, [jsonResponse({ id: 4242 }, 200), jsonResponse(body, 201)]);

    // Act / Assert
    await assert.rejects(
      attach(filePath, { repo: "owner/repo", token: AUTH_VALUE }),
      hasAttachError("endpoint-changed", 201),
    );
  });
}

test("attach classifies a non-JSON 201 response as endpoint-changed", async (t) => {
  // Arrange
  const { filePath } = await temporaryFile(t);
  mockFetchSequence(t, [
    jsonResponse({ id: 4242 }, 200),
    new Response("not-json", { status: 201 }),
  ]);

  // Act / Assert
  await assert.rejects(
    attach(filePath, { repo: "owner/repo", token: AUTH_VALUE }),
    hasAttachError("endpoint-changed", 201),
  );
});

test("attach sanitises control characters in response detail", async (t) => {
  // Arrange
  const { filePath } = await temporaryFile(t);
  mockFetchSequence(t, [
    jsonResponse({ id: 4242 }, 200),
    jsonResponse({ url: "\u001b[31mforged\u202ereversed" }, 201),
  ]);

  // Act / Assert
  await assert.rejects(
    attach(filePath, { repo: "owner/repo", token: AUTH_VALUE }),
    (error) => {
      assert.ok(error instanceof GitHubAttachError);
      assert.equal(error.kind, "endpoint-changed");
      assert.doesNotMatch(error.detail, /[\u001b\u202e]/);
      return true;
    },
  );
});

test("attach rejects a missing file before making a request", async (t) => {
  // Arrange
  const directory = await temporaryDirectory(t);
  const filePath = join(directory, "missing.mp4");
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("fetch called"));

  // Act / Assert
  await assert.rejects(
    attach(filePath, { repo: "owner/repo", token: AUTH_VALUE }),
    hasAttachError("file"),
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test("attach rejects a directory because it is not a regular file", async (t) => {
  // Arrange
  const directory = await temporaryDirectory(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("fetch called"));

  // Act / Assert
  await assert.rejects(
    attach(directory, { repo: "owner/repo", token: AUTH_VALUE }),
    hasAttachError("file"),
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test("attach rejects a sparse file above 100 MiB before reading or uploading it", async (t) => {
  // Arrange: truncate creates a sparse file, so this does not allocate a 100 MiB fixture.
  const directory = await temporaryDirectory(t);
  const filePath = join(directory, "oversized.mp4");
  const handle = await open(filePath, "w");
  await handle.truncate(MAX_ATTACHMENT_BYTES + 1);
  await handle.close();
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("fetch called"));

  // Act / Assert
  await assert.rejects(
    attach(filePath, { repo: "owner/repo", token: AUTH_VALUE }),
    hasAttachError("too-large"),
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test("attach rejects an unsupported MIME type before repository lookup", async (t) => {
  // Arrange
  const { filePath } = await temporaryFile(t, "notes.txt", Buffer.from("hello"));
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("fetch called"));

  // Act / Assert
  await assert.rejects(
    attach(filePath, { repo: "owner/repo", token: AUTH_VALUE }),
    hasAttachError("invalid-input"),
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test("attach rejects an explicit unsupported MIME override before repository lookup", async (t) => {
  // Arrange
  const { filePath } = await temporaryFile(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("fetch called"));

  // Act / Assert
  await assert.rejects(
    attach(filePath, {
      repo: "owner/repo",
      token: AUTH_VALUE,
      contentType: "application/pdf",
    }),
    hasAttachError("invalid-input"),
  );
  assert.equal(fetch.mock.callCount(), 0);
});

for (const { label, status, body, headers, kind } of [
  { label: "401", status: 401, body: { message: "bad credentials" }, kind: "auth" },
  { label: "403", status: 403, body: { message: "forbidden" }, kind: "auth" },
  {
    label: "rate-limited 403",
    status: 403,
    body: { message: "rate limit exceeded" },
    headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1786300000" },
    kind: "rate-limit",
  },
  { label: "404", status: 404, body: { message: "not found" }, kind: "upload-unavailable" },
  { label: "413", status: 413, body: { message: "too large" }, kind: "too-large" },
  {
    label: "422 size validation",
    status: 422,
    body: { message: "invalid", errors: [{ field: "size", message: "too large" }] },
    kind: "too-large",
  },
  {
    label: "other 422 validation",
    status: 422,
    body: { message: "invalid", errors: [{ field: "name", message: "bad name" }] },
    kind: "invalid-input",
  },
  { label: "429", status: 429, body: { message: "slow down" }, kind: "rate-limit" },
  { label: "500", status: 500, body: { message: "server error" }, kind: "server" },
  { label: "503", status: 503, body: { message: "unavailable" }, kind: "server" },
]) {
  test(`attach classifies upload HTTP ${label} as ${kind}`, async (t) => {
    // Arrange
    const { filePath } = await temporaryFile(t);
    const response = jsonResponse(body, status);
    for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
    mockFetchSequence(t, [jsonResponse({ id: 4242 }, 200), response]);

    // Act / Assert
    await assert.rejects(
      attach(filePath, { repo: "owner/repo", token: AUTH_VALUE }),
      hasAttachError(kind, status),
    );
  });
}

for (const { label, status, headers, kind } of [
  { label: "401", status: 401, kind: "auth" },
  {
    label: "rate-limited 403",
    status: 403,
    headers: { "x-ratelimit-remaining": "0" },
    kind: "rate-limit",
  },
  { label: "404", status: 404, kind: "not-found" },
  { label: "429", status: 429, kind: "rate-limit" },
  { label: "500", status: 500, kind: "server" },
]) {
  test(`attach classifies repository lookup HTTP ${label} as ${kind}`, async (t) => {
    // Arrange
    const { filePath } = await temporaryFile(t);
    const response = jsonResponse({ message: "lookup failed" }, status);
    for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
    mockFetchSequence(t, [response]);

    // Act / Assert
    await assert.rejects(
      attach(filePath, { repo: "owner/repo", token: AUTH_VALUE }),
      hasAttachError(kind, status),
    );
  });
}

test("attach normalises a network failure without exposing its credential", async (t) => {
  // Arrange
  const { filePath } = await temporaryFile(t);
  const cause = new TypeError("fetch failed");
  mockFetchSequence(t, [jsonResponse({ id: 4242 }, 200), () => Promise.reject(cause)]);

  // Act / Assert
  await assert.rejects(
    attach(filePath, { repo: "owner/repo", token: AUTH_VALUE }),
    (error) => {
      assert.ok(error instanceof GitHubAttachError);
      assert.equal(error.kind, "network");
      assert.equal(error.cause, cause);
      assert.doesNotMatch(error.message, new RegExp(AUTH_VALUE));
      return true;
    },
  );
});

test("attach normalises an aborted request", async (t) => {
  // Arrange
  const { filePath } = await temporaryFile(t);
  const cause = new DOMException("This operation was aborted", "AbortError");
  mockFetchSequence(t, [jsonResponse({ id: 4242 }, 200), () => Promise.reject(cause)]);

  // Act / Assert
  await assert.rejects(
    attach(filePath, { repo: "owner/repo", token: AUTH_VALUE }),
    (error) => {
      assert.ok(error instanceof GitHubAttachError);
      assert.equal(error.kind, "aborted");
      assert.equal(error.cause, cause);
      return true;
    },
  );
});
