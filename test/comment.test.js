import test from "node:test";
import assert from "node:assert/strict";
import { comment, GitHubAttachError } from "../dist/index.js";

const AUTH_VALUE = "fixture-credential";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function hasAttachError(kind, status) {
  return (error) => {
    assert.ok(error instanceof GitHubAttachError);
    assert.equal(error.kind, kind);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  };
}

test("comment posts Markdown to the requested issue and returns the comment URL", async (t) => {
  // Arrange
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return jsonResponse({ html_url: "https://github.com/owner/repo/issues/7#issuecomment-42" }, 201);
  });

  // Act
  const result = await comment({
    repo: "owner/repo",
    issue: 7,
    body: "![clip](https://example.invalid/clip)",
    token: AUTH_VALUE,
  });

  // Assert
  assert.equal(result, "https://github.com/owner/repo/issues/7#issuecomment-42");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/owner/repo/issues/7/comments");
  assert.equal(calls[0].init.method, "POST");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("authorization"), `Bearer ${AUTH_VALUE}`);
  assert.equal(headers.get("accept"), "application/vnd.github+json");
  assert.equal(headers.get("x-github-api-version"), "2022-11-28");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    body: "![clip](https://example.invalid/clip)",
  });
  assert.doesNotMatch(calls[0].url, new RegExp(AUTH_VALUE));
});

for (const { label, status, headers, kind } of [
  { label: "401", status: 401, kind: "auth" },
  { label: "403", status: 403, kind: "auth" },
  {
    label: "rate-limited 403",
    status: 403,
    headers: { "x-ratelimit-remaining": "0" },
    kind: "rate-limit",
  },
  { label: "404", status: 404, kind: "not-found" },
  { label: "422", status: 422, kind: "invalid-input" },
  { label: "429", status: 429, kind: "rate-limit" },
  { label: "500", status: 500, kind: "server" },
  { label: "503", status: 503, kind: "server" },
]) {
  test(`comment classifies HTTP ${label} as ${kind}`, async (t) => {
    // Arrange
    const response = jsonResponse({ message: "comment failed" }, status);
    for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
    t.mock.method(globalThis, "fetch", async () => response);

    // Act / Assert
    await assert.rejects(
      comment({
        repo: "owner/repo",
        issue: 7,
        body: "body",
        token: AUTH_VALUE,
      }),
      hasAttachError(kind, status),
    );
  });
}

test("comment classifies a non-JSON success response as endpoint-changed", async (t) => {
  // Arrange
  t.mock.method(globalThis, "fetch", async () => new Response("not-json", { status: 201 }));

  // Act / Assert
  await assert.rejects(
    comment({ repo: "owner/repo", issue: 7, body: "body", token: AUTH_VALUE }),
    hasAttachError("endpoint-changed", 201),
  );
});

test("comment classifies a success response without html_url as endpoint-changed", async (t) => {
  // Arrange
  t.mock.method(globalThis, "fetch", async () => jsonResponse({}, 201));

  // Act / Assert
  await assert.rejects(
    comment({ repo: "owner/repo", issue: 7, body: "body", token: AUTH_VALUE }),
    hasAttachError("endpoint-changed", 201),
  );
});

test("comment rejects a non-positive issue number before making a request", async (t) => {
  // Arrange
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("fetch called"));

  // Act / Assert
  await assert.rejects(
    comment({ repo: "owner/repo", issue: 0, body: "body", token: AUTH_VALUE }),
    hasAttachError("invalid-input"),
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test("comment normalises a network failure without exposing its credential", async (t) => {
  // Arrange
  const cause = new TypeError("fetch failed");
  t.mock.method(globalThis, "fetch", async () => {
    throw cause;
  });

  // Act / Assert
  await assert.rejects(
    comment({ repo: "owner/repo", issue: 7, body: "body", token: AUTH_VALUE }),
    (error) => {
      assert.ok(error instanceof GitHubAttachError);
      assert.equal(error.kind, "network");
      assert.equal(error.cause, cause);
      assert.doesNotMatch(error.message, new RegExp(AUTH_VALUE));
      return true;
    },
  );
});

test("comment normalises an aborted request", async (t) => {
  // Arrange
  const cause = new DOMException("This operation was aborted", "AbortError");
  t.mock.method(globalThis, "fetch", async () => {
    throw cause;
  });

  // Act / Assert
  await assert.rejects(
    comment({ repo: "owner/repo", issue: 7, body: "body", token: AUTH_VALUE }),
    (error) => {
      assert.ok(error instanceof GitHubAttachError);
      assert.equal(error.kind, "aborted");
      assert.equal(error.cause, cause);
      return true;
    },
  );
});
