import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const zeroSha = "0".repeat(40);

export function resolveCommitRange(eventName, event, cwd = process.cwd()) {
  function commit(ref) {
    if (typeof ref !== "string" || !ref) {
      throw new Error("Missing commit reference in the GitHub event.");
    }
    return execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  if (eventName === "pull_request") {
    return { base: commit(event.pull_request.base.sha), head: commit(event.pull_request.head.sha) };
  }

  if (eventName === "push") {
    const head = commit(event.after);
    if (event.before !== zeroSha) {
      // Fail if the old tip is unavailable rather than silently skipping commits.
      return { base: commit(event.before), head };
    }

    const defaultBranch = event.repository.default_branch;
    if (event.ref === `refs/heads/${defaultBranch}`) {
      return { base: "", head }; // Initial push: include the root commit.
    }

    const defaultTip = commit(`refs/remotes/origin/${defaultBranch}`);
    const result = spawnSync("git", ["merge-base", defaultTip, head], { cwd, encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status === 1) return { base: "", head }; // An orphan branch has no shared history.
    if (result.status !== 0) throw new Error(result.stderr || "Cannot determine the branch base.");
    return { base: result.stdout.trim(), head };
  }

  if (eventName === "workflow_dispatch") {
    const head = commit("HEAD");
    const parents = execFileSync("git", ["rev-list", "--parents", "-n", "1", head], {
      cwd,
      encoding: "utf8",
    }).trim().split(" ");
    return { base: parents[1] ?? "", head };
  }

  throw new Error(`Unsupported GitHub event: ${eventName}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const { base, head } = resolveCommitRange(process.env.GITHUB_EVENT_NAME, event);
    process.stdout.write(`base=${base}\nhead=${head}\n`);
  } catch (error) {
    console.error(`Cannot select CI commits: ${error.message}`);
    process.exitCode = 1;
  }
}
