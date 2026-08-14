import test from "node:test";
import assert from "node:assert/strict";
import { appendToBody, GitHubAttachError } from "../dist/index.js";

const AUTH_VALUE = "fixture-credential";
const ISSUE_URL = "https://api.github.com/repos/owner/repo/issues/7";
const WEB_URL = "https://github.com/owner/repo/issues/7";
const MARKDOWN = "![clip](https://example.invalid/clip)";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Answers each call in turn so a test can fail the read and the write apart. */
function stubFetch(t, responses) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const response = responses[calls.length - 1];
    if (response === undefined) assert.fail(`unexpected request to ${String(input)}`);
    return response;
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

test("appendToBody reads the current body and writes it back with the addition", async (t) => {
  // Arrange
  const calls = stubFetch(t, [
    jsonResponse({ body: "existing body" }, 200),
    jsonResponse({ html_url: WEB_URL }, 200),
  ]);

  // Act
  const result = await appendToBody({
    repo: "owner/repo",
    issue: 7,
    body: MARKDOWN,
    token: AUTH_VALUE,
  });

  // Assert
  assert.equal(result, WEB_URL);
  assert.equal(calls.length, 2);

  assert.equal(calls[0].url, ISSUE_URL);
  assert.equal(calls[0].init.method, undefined);
  const readHeaders = new Headers(calls[0].init.headers);
  assert.equal(readHeaders.get("authorization"), `Bearer ${AUTH_VALUE}`);
  assert.equal(readHeaders.get("accept"), "application/vnd.github+json");
  assert.equal(readHeaders.get("x-github-api-version"), "2022-11-28");

  assert.equal(calls[1].url, ISSUE_URL);
  assert.equal(calls[1].init.method, "PATCH");
  const writeHeaders = new Headers(calls[1].init.headers);
  assert.equal(writeHeaders.get("authorization"), `Bearer ${AUTH_VALUE}`);
  assert.equal(writeHeaders.get("accept"), "application/vnd.github+json");
  assert.equal(writeHeaders.get("x-github-api-version"), "2022-11-28");
  assert.equal(writeHeaders.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(calls[1].init.body), { body: `existing body\n\n${MARKDOWN}` });

  assert.doesNotMatch(calls[0].url, new RegExp(AUTH_VALUE));
  assert.doesNotMatch(calls[1].url, new RegExp(AUTH_VALUE));
});

test("appendToBody drops trailing whitespace before joining with a blank line", async (t) => {
  // Arrange
  const calls = stubFetch(t, [
    jsonResponse({ body: "existing body\n\n\n  " }, 200),
    jsonResponse({ html_url: WEB_URL }, 200),
  ]);

  // Act
  await appendToBody({ repo: "owner/repo", issue: 7, body: MARKDOWN, token: AUTH_VALUE });

  // Assert
  assert.deepEqual(JSON.parse(calls[1].init.body), { body: `existing body\n\n${MARKDOWN}` });
});

for (const { label, body } of [
  { label: "null", body: null },
  { label: "empty", body: "" },
  { label: "whitespace only", body: " \n\t " },
]) {
  test(`appendToBody writes only the addition when the body is ${label}`, async (t) => {
    // Arrange
    const calls = stubFetch(t, [
      jsonResponse({ body }, 200),
      jsonResponse({ html_url: WEB_URL }, 200),
    ]);

    // Act
    await appendToBody({ repo: "owner/repo", issue: 7, body: MARKDOWN, token: AUTH_VALUE });

    // Assert
    assert.deepEqual(JSON.parse(calls[1].init.body), { body: MARKDOWN });
  });
}

test("appendToBody reports a missing target from the read without writing", async (t) => {
  // Arrange
  const calls = stubFetch(t, [jsonResponse({ message: "Not Found" }, 404)]);

  // Act / Assert
  await assert.rejects(
    appendToBody({ repo: "owner/repo", issue: 7, body: MARKDOWN, token: AUTH_VALUE }),
    hasAttachError("not-found", 404),
  );
  assert.equal(calls.length, 1);
});

test("appendToBody reports a rejected write as auth", async (t) => {
  // Arrange
  stubFetch(t, [
    jsonResponse({ body: "existing body" }, 200),
    jsonResponse({ message: "Resource not accessible by integration" }, 403),
  ]);

  // Act / Assert
  await assert.rejects(
    appendToBody({ repo: "owner/repo", issue: 7, body: MARKDOWN, token: AUTH_VALUE }),
    hasAttachError("auth", 403),
  );
});

test("appendToBody classifies a read body of the wrong type as endpoint-changed", async (t) => {
  // Arrange
  stubFetch(t, [jsonResponse({ body: 42 }, 200)]);

  // Act / Assert
  await assert.rejects(
    appendToBody({ repo: "owner/repo", issue: 7, body: MARKDOWN, token: AUTH_VALUE }),
    hasAttachError("endpoint-changed", 200),
  );
});

test("appendToBody classifies a write response without html_url as endpoint-changed", async (t) => {
  // Arrange
  stubFetch(t, [jsonResponse({ body: "existing body" }, 200), jsonResponse({}, 200)]);

  // Act / Assert
  await assert.rejects(
    appendToBody({ repo: "owner/repo", issue: 7, body: MARKDOWN, token: AUTH_VALUE }),
    hasAttachError("endpoint-changed", 200),
  );
});

test("appendToBody refuses a write response pointing away from github.com", async (t) => {
  // Arrange
  stubFetch(t, [
    jsonResponse({ body: "existing body" }, 200),
    jsonResponse({ html_url: "https://github.com.example.invalid/owner/repo/issues/7" }, 200),
  ]);

  // Act / Assert
  await assert.rejects(
    appendToBody({ repo: "owner/repo", issue: 7, body: MARKDOWN, token: AUTH_VALUE }),
    hasAttachError("endpoint-changed", 200),
  );
});

test("appendToBody classifies a non-JSON write response as endpoint-changed", async (t) => {
  // Arrange
  stubFetch(t, [
    jsonResponse({ body: "existing body" }, 200),
    new Response("not-json", { status: 200 }),
  ]);

  // Act / Assert
  await assert.rejects(
    appendToBody({ repo: "owner/repo", issue: 7, body: MARKDOWN, token: AUTH_VALUE }),
    hasAttachError("endpoint-changed", 200),
  );
});

for (const { label, options } of [
  { label: "a repo that is not owner/name", options: { repo: "owner", issue: 7, body: MARKDOWN } },
  { label: "a repo that is not a string", options: { repo: 7, issue: 7, body: MARKDOWN } },
  { label: "a non-positive issue", options: { repo: "owner/repo", issue: 0, body: MARKDOWN } },
  { label: "a fractional issue", options: { repo: "owner/repo", issue: 1.5, body: MARKDOWN } },
  { label: "a body that is not a string", options: { repo: "owner/repo", issue: 7, body: 42 } },
  { label: "a blank token", options: { repo: "owner/repo", issue: 7, body: MARKDOWN, token: " " } },
]) {
  test(`appendToBody rejects ${label} before making a request`, async (t) => {
    // Arrange
    const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("fetch called"));

    // Act / Assert
    await assert.rejects(
      appendToBody({ token: AUTH_VALUE, ...options }),
      hasAttachError("invalid-input"),
    );
    assert.equal(fetch.mock.callCount(), 0);
  });
}

test("appendToBody normalises a network failure without exposing its credential", async (t) => {
  // Arrange
  const cause = new TypeError("fetch failed");
  t.mock.method(globalThis, "fetch", async () => {
    throw cause;
  });

  // Act / Assert
  await assert.rejects(
    appendToBody({ repo: "owner/repo", issue: 7, body: MARKDOWN, token: AUTH_VALUE }),
    (error) => {
      assert.ok(error instanceof GitHubAttachError);
      assert.equal(error.kind, "network");
      assert.equal(error.cause, cause);
      assert.doesNotMatch(error.message, new RegExp(AUTH_VALUE));
      return true;
    },
  );
});

test("appendToBody normalises an aborted request", async (t) => {
  // Arrange
  const controller = new AbortController();
  controller.abort();
  const cause = new DOMException("This operation was aborted", "AbortError");
  t.mock.method(globalThis, "fetch", async () => {
    throw cause;
  });

  // Act / Assert
  await assert.rejects(
    appendToBody({
      repo: "owner/repo",
      issue: 7,
      body: MARKDOWN,
      token: AUTH_VALUE,
      signal: controller.signal,
    }),
    (error) => {
      assert.ok(error instanceof GitHubAttachError);
      assert.equal(error.kind, "aborted");
      assert.equal(error.cause, cause);
      return true;
    },
  );
});

test("appendToBody passes the caller's signal to both requests", async (t) => {
  // Arrange
  const controller = new AbortController();
  const calls = stubFetch(t, [
    jsonResponse({ body: "existing body" }, 200),
    jsonResponse({ html_url: WEB_URL }, 200),
  ]);

  // Act
  await appendToBody({
    repo: "owner/repo",
    issue: 7,
    body: MARKDOWN,
    token: AUTH_VALUE,
    signal: controller.signal,
  });

  // Assert
  assert.equal(calls[0].init.signal, controller.signal);
  assert.equal(calls[1].init.signal, controller.signal);
});
