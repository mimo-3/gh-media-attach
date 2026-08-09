import test from "node:test";
import assert from "node:assert/strict";
import { toMarkdown } from "../dist/render.js";

const asset = (overrides) => ({
  url: "https://github.com/user-attachments/assets/9a34c7bd-6b09-430a-a1f4-335bf67e4a34",
  name: "demo.mp4",
  contentType: "video/mp4",
  size: 1024,
  ...overrides,
});

test("videos become a video tag, never an image", () => {
  const markdown = toMarkdown(asset());
  assert.match(markdown, /^<video src="https:\/\/github\.com\/user-attachments\/assets\//);
  assert.match(markdown, /controls><\/video>$/);
  assert.doesNotMatch(markdown, /!\[/);
});

test("images become image syntax", () => {
  const markdown = toMarkdown(asset({ name: "chart.png", contentType: "image/png" }));
  assert.equal(
    markdown,
    "![chart.png](https://github.com/user-attachments/assets/9a34c7bd-6b09-430a-a1f4-335bf67e4a34)",
  );
});

test("a trailing backslash in the name does not swallow the closing bracket", () => {
  const markdown = toMarkdown(asset({ name: "weird\\", contentType: "image/png" }));
  assert.match(markdown, /^!\[weird\\\\\]\(/);
});

test("brackets in the name are escaped", () => {
  const markdown = toMarkdown(asset({ name: "a[b]c.png", contentType: "image/png" }));
  assert.match(markdown, /^!\[a\\\[b\\\]c\.png\]\(/);
});

test("newlines in the name cannot split the markdown", () => {
  const markdown = toMarkdown(asset({ name: "a\nb.png", contentType: "image/png" }));
  assert.equal(markdown.split("\n").length, 1);
});

test("a quote in the url cannot escape the video tag attribute", () => {
  const markdown = toMarkdown(asset({ url: 'https://example.com/x" onerror="alert(1)' }));
  assert.doesNotMatch(markdown, /onerror="/);
  assert.match(markdown, /&quot;/);
});
