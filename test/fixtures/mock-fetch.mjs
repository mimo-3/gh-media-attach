const ASSET_URL =
  "https://github.com/user-attachments/assets/9a34c7bd-6b09-430a-a1f4-335bf67e4a34";

// #7 is an issue whose write fails; #8 is a pull request whose write succeeds.
const ISSUE = "https://api.github.com/repos/owner/repo/issues/7";
const PULL = "https://api.github.com/repos/owner/repo/issues/8";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);

  if (url === "https://api.github.com/repos/owner/repo") {
    return jsonResponse({ id: 4242 }, 200);
  }

  if (url.startsWith("https://uploads.github.com/user-attachments/assets?")) {
    return jsonResponse({ url: ASSET_URL }, 201);
  }

  if (url === `${ISSUE}/comments`) {
    return jsonResponse({ message: "service unavailable" }, 503);
  }

  if (url === ISSUE) {
    if (init.method === "PATCH") {
      return jsonResponse({ message: "service unavailable" }, 503);
    }
    return jsonResponse({ body: "existing body" }, 200);
  }

  if (url === PULL) {
    if (init.method === "PATCH") {
      return jsonResponse(
        { html_url: "https://github.com/owner/repo/pull/8", body: JSON.parse(init.body).body },
        200,
      );
    }
    return jsonResponse(
      { body: "existing body", pull_request: { url: `${PULL}/pull` } },
      200,
    );
  }

  throw new Error(`unexpected request to ${url}`);
};
