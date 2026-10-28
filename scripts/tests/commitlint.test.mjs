import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = fileURLToPath(new URL("../../node_modules/@commitlint/cli/cli.js", import.meta.url));

function check(message) {
  const result = spawnSync(process.execPath, [cli], {
    cwd: root,
    input: `${message}\n`,
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, null, result.stderr);
  return result;
}

for (const message of [
  "feat(backend): add health endpoint",
  "fix(ingestion): preserve missing sensor values",
  "docs(project): explain local setup",
  "ci(repo): add quality checks",
  "update(backend): handle HTTP 429 responses",
  "add(api): expose source metadata",
  `fix(api): ${"x".repeat(62)}`, // Exactly 72 characters.
]) {
  test(`accepts ${JSON.stringify(message)}`, () => {
    const result = check(message);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}

for (const message of [
  "fix: missing scope",
  "fix(): missing target",
  "Fix(backend): uppercase verb",
  "fix(Backend): uppercase scope",
  "fix(backend):missing space",
  "fix(backend):  extra space",
  "fix(backend): ",
  "a free-form commit message",
  "fix(backend): add a check\n\nAn extra body is not one line.",
  "fix(backend): add a check\n\nCloses #123",
  "Merge branch 'dev'",
  "",
  `fix(api): ${"x".repeat(63)}`, // 73 characters.
]) {
  test(`rejects ${JSON.stringify(message)}`, () => {
    const result = check(message);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  });
}
