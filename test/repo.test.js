import test from "node:test";
import assert from "node:assert/strict";
import { splitRepo } from "../dist/repo.js";

test("splits owner and name", () => {
  assert.deepEqual(splitRepo("mimo-3/gh-media-attach"), {
    owner: "mimo-3",
    name: "gh-media-attach",
  });
});

test("accepts dots and underscores inside a segment", () => {
  assert.deepEqual(splitRepo("some.org/my_repo.js"), {
    owner: "some.org",
    name: "my_repo.js",
  });
});

test("rejects path traversal that URL normalisation would resolve", () => {
  // "https://api.github.com/repos/../x" collapses to "https://api.github.com/x".
  assert.throws(() => splitRepo("../x"), /owner\/name/);
  assert.throws(() => splitRepo("x/.."), /owner\/name/);
  assert.throws(() => splitRepo("./x"), /owner\/name/);
});

test("rejects the wrong number of segments", () => {
  assert.throws(() => splitRepo("just-a-name"), /owner\/name/);
  assert.throws(() => splitRepo("a/b/c"), /owner\/name/);
  assert.throws(() => splitRepo(""), /owner\/name/);
  assert.throws(() => splitRepo("a/"), /owner\/name/);
});

test("rejects characters that do not belong in a URL path", () => {
  assert.throws(() => splitRepo("a b/c"), /owner\/name/);
  assert.throws(() => splitRepo("a/c?x=1"), /owner\/name/);
  assert.throws(() => splitRepo("a/c#frag"), /owner\/name/);
});
