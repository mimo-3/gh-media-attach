import test from "node:test";
import assert from "node:assert/strict";
import { ensureExtension, guessContentType, isVideo } from "../dist/mime.js";

test("maps the extensions GitHub renders inline", () => {
  assert.equal(guessContentType("demo.mp4"), "video/mp4");
  assert.equal(guessContentType("demo.MOV"), "video/quicktime");
  assert.equal(guessContentType("/tmp/a/b/chart.png"), "image/png");
  assert.equal(guessContentType("photo.jpeg"), "image/jpeg");
});

test("refuses to guess rather than uploading as octet-stream", () => {
  assert.throws(() => guessContentType("notes.txt"), /content type/);
  assert.throws(() => guessContentType("Makefile"), /content type/);
});

test("only video types count as video", () => {
  assert.equal(isVideo("video/mp4"), true);
  assert.equal(isVideo("image/png"), false);
});

test("a renamed file keeps an extension, because GitHub rejects names without one", () => {
  assert.equal(ensureExtension("スクショ", "/tmp/probe.png", "image/png"), "スクショ.png");
  assert.equal(ensureExtension("demo", "/tmp/a.b/clip.mp4", "video/mp4"), "demo.mp4");
});

test("an explicit matching extension is left alone", () => {
  assert.equal(ensureExtension("thumb.png", "/tmp/clip.mp4", "image/png"), "thumb.png");
  assert.equal(ensureExtension("demo.mp4", "/tmp/demo.mp4", "video/mp4"), "demo.mp4");
});

test("a display extension that disagrees with the content type is rejected", () => {
  assert.throws(
    () => ensureExtension("thumb.png", "/tmp/clip.mp4", "video/mp4"),
    /does not match content type/,
  );
});
