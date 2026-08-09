const ASSET_URL =
  "https://github.com/user-attachments/assets/9a34c7bd-6b09-430a-a1f4-335bf67e4a34";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

globalThis.fetch = async (input) => {
  const url = String(input);

  if (url === "https://api.github.com/repos/owner/repo") {
    return jsonResponse({ id: 4242 }, 200);
  }

  if (url.startsWith("https://uploads.github.com/user-attachments/assets?")) {
    return jsonResponse({ url: ASSET_URL }, 201);
  }

  if (url === "https://api.github.com/repos/owner/repo/issues/7/comments") {
    return jsonResponse({ message: "comment service unavailable" }, 503);
  }

  throw new Error(`unexpected request to ${url}`);
};
