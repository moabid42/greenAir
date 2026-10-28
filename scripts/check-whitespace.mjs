import { execFileSync, spawnSync } from "node:child_process";

try {
  const [base, head] = process.argv.slice(2);
  if (!head) throw new Error("Usage: node scripts/check-whitespace.mjs BASE_SHA HEAD_SHA");

  const from = base || execFileSync("git", ["hash-object", "-t", "tree", "--stdin"], {
    input: "",
    encoding: "utf8",
  }).trim();
  const range = process.env.GITHUB_EVENT_NAME === "pull_request" && base
    ? [`${base}...${head}`]
    : [from, head];
  const result = spawnSync("git", ["diff", "--check", ...range, "--"], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`Cannot check committed whitespace: ${error.message}`);
  process.exitCode = 1;
}
