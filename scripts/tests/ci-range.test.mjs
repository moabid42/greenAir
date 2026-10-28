import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolveCommitRange } from "../ci-range.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = join(root, "node_modules/@commitlint/cli/cli.js");
const zeroSha = "0".repeat(40);

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "greenair-ci-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "CI Test");
  git("config", "user.email", "ci@example.invalid");
  git("config", "core.hooksPath", join(cwd, ".git/hooks"));
  const commit = (message) => {
    git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };
  return { cwd, git, commit };
}

function push(before, after, ref = "refs/heads/feature") {
  return { before, after, ref, repository: { default_branch: "main" } };
}

function lint(cwd, { base, head }) {
  const args = [cli, "--config", join(root, "commitlint.config.cjs"), "--to", head];
  if (base) args.push("--from", base);
  return spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
}

test("a push rejects an invalid earlier commit even when the tip is valid", (t) => {
  const { cwd, commit } = repository(t);
  const base = commit("Historical message outside the push");
  commit("invalid earlier message");
  const head = commit("fix(ci): valid final message");
  const range = resolveCommitRange("push", push(base, head), cwd);
  assert.deepEqual(range, { base, head });
  const result = lint(cwd, range);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /invalid earlier message/);
  assert.doesNotMatch(result.stdout, /Historical message/);
});

test("a new branch excludes shared history even when the default branch has advanced", (t) => {
  const { cwd, git, commit } = repository(t);
  const base = commit("Historical message outside the new branch");
  git("checkout", "-b", "feature");
  const head = commit("feat(ci): add a branch change");
  git("checkout", "main");
  const defaultTip = commit("fix(ci): advance the default branch");
  git("update-ref", "refs/remotes/origin/main", defaultTip);
  const range = resolveCommitRange("push", push(zeroSha, head), cwd);
  assert.deepEqual(range, { base, head });
  const result = lint(cwd, range);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("an initial default-branch push includes the root commit", (t) => {
  const { cwd, commit } = repository(t);
  commit("invalid initial message");
  const head = commit("fix(ci): valid final message");
  const range = resolveCommitRange("push", push(zeroSha, head, "refs/heads/main"), cwd);
  assert.deepEqual(range, { base: "", head });
  const result = lint(cwd, range);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /invalid initial message/);
});

test("an orphan branch includes all of its own history", (t) => {
  const { cwd, git, commit } = repository(t);
  const defaultTip = commit("chore(ci): initialize the default branch");
  git("update-ref", "refs/remotes/origin/main", defaultTip);
  git("checkout", "--orphan", "separate");
  const head = commit("chore(ci): initialize separate history");
  assert.deepEqual(resolveCommitRange("push", push(zeroSha, head), cwd), { base: "", head });
});

test("a force push uses the previous tip even when it is not an ancestor", (t) => {
  const { cwd, git, commit } = repository(t);
  const shared = commit("chore(ci): initialize history");
  const base = commit("feat(ci): original change");
  git("checkout", "-b", "replacement", shared);
  const head = commit("fix(ci): replacement change");
  assert.deepEqual(resolveCommitRange("push", push(base, head), cwd), { base, head });
});

test("a missing previous tip fails instead of checking only the latest commit", (t) => {
  const { cwd, commit } = repository(t);
  const head = commit("chore(ci): initialize history");
  assert.throws(() => resolveCommitRange("push", push("f".repeat(40), head), cwd));
});

test("a pull request uses its event head rather than the checkout merge commit", (t) => {
  const { cwd, commit } = repository(t);
  const base = commit("chore(ci): initialize history");
  const head = commit("feat(ci): add a change");
  commit("chore(ci): simulate a different checkout tip");
  const event = { pull_request: { base: { sha: base }, head: { sha: head } } };
  assert.deepEqual(resolveCommitRange("pull_request", event, cwd), { base, head });
});

test("manual runs check the latest commit, including a root commit", (t) => {
  const { cwd, commit } = repository(t);
  const base = commit("chore(ci): initialize history");
  assert.deepEqual(resolveCommitRange("workflow_dispatch", {}, cwd), { base: "", head: base });
  const head = commit("feat(ci): add a change");
  assert.deepEqual(resolveCommitRange("workflow_dispatch", {}, cwd), { base, head });
});
