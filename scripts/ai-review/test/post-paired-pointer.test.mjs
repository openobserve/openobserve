import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../post-paired-pointer.sh");
const MARKER = "<!-- ai-code-review -->";
const BOT = "o2-reviewer[bot]";

function runWithFakeGh(t, pages) {
  const dir = mkdtempSync(join(tmpdir(), "pointer-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "pages.txt"), pages.map(p => JSON.stringify(p)).join(""));
  writeFileSync(join(dir, "gh"), `#!/usr/bin/env bash
if [ "$2" = "-X" ]; then echo "$3 $4" >> "${dir}/calls.log"; exit 0; fi
cat "${dir}/pages.txt"
`);
  chmodSync(join(dir, "gh"), 0o755);
  execFileSync("bash", [SCRIPT, "o/r", "7", MARKER, "o/e#9", "reviewed", BOT], {
    env: { PATH: `${dir}:${process.env.PATH}` },
  });
  return readFileSync(join(dir, "calls.log"), "utf-8").trim();
}

const comment = (id, login, body) => ({ id, user: { login }, body });

test("updates the newest marker comment of the bot, across pages", t => {
  const calls = runWithFakeGh(t, [
    [comment(1, BOT, `${MARKER}\nold`), comment(2, "mallory", MARKER)],
    [comment(3, BOT, `${MARKER}\nnewer`), comment(4, "github-actions[bot]", MARKER)],
  ]);
  assert.equal(calls, "PATCH repos/o/r/issues/comments/3");
});

test("posts a new comment when only other authors carry the marker", t => {
  const calls = runWithFakeGh(t, [[comment(2, "mallory", MARKER), comment(4, "github-actions[bot]", MARKER)]]);
  assert.equal(calls, "POST repos/o/r/issues/7/comments");
});
