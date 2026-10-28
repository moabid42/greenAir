# Development checks and commits

Use Python 3.12, uv 0.13.6, just 1.46.0, and Node.js 24 with npm; see
[the development pins](docs/development.md). The root npm package
contains development tooling; the web client remains a reserved directory.

```sh
just setup
just lint
just test
```

`just setup` runs `npm ci` and installs locked Python dependencies. The npm
`prepare` script activates [Husky](https://typicode.github.io/husky/get-started.html)
for this clone. After pulling changes to npm dependencies, run `npm ci` again.
Keep `package-lock.json` and `services/backend/uv.lock` tracked.

## Local hooks

| Hook | Check |
|---|---|
| `pre-commit` | `just lint`: backend Ruff lint/format, research integrity, tooling syntax, and staged/unstaged whitespace |
| `commit-msg` | commitlint enforces the message convention below |
| `pre-push` | `just test`: backend, agent-tool, and commit-rule regression tests |

Lint checks the working tree and does not change or stage files. Run `just format`
to format backend Python deliberately. The hooks require `just`, `uv`, `node`,
and `npm` on the Git process's PATH; run setup from the same environment used by
your terminal or Git client. Tests do not contact data providers or need a database.

## Commit convention

Use exactly one nonempty line, at most **72 characters total**:

```text
verb(scope): short message
```

The verb is lowercase, for example `feat`, `fix`, `docs`, `refactor`, `test`,
`chore`, `ci`, `add`, `update`, or `remove`. It is not restricted to a fixed list.
The scope is required: use a lowercase service or target such as `backend`,
`ingestion`, `api`, `docs`, `ci`, or `project`. Scope names can include digits,
dots, underscores, hyphens, or slashes. Use exactly one space after the colon,
keep the summary concise, and omit a trailing full stop. Message bodies and
footers are rejected.

Examples:

```text
feat(backend): add health endpoint
fix(ingestion): preserve missing values
ci(project): add quality checks
docs(api): explain local setup
```

To check a message file without creating a commit:

```sh
npm run commitlint -- --edit /path/to/message.txt
```

These rules follow [commitlint's configurable conventional format](https://commitlint.js.org/reference/configuration.html),
with a mandatory scope, flexible verb, and single-line restriction. They apply
to new commits; existing history is not rewritten. There are no automatic
merge/revert/fixup exemptions. For squash merges, use a conforming final message;
automatic merge messages need the same format.

## GitHub Actions

[CI](.github/workflows/ci.yml) runs on pushes, pull requests, and manual dispatch.
It installs locked dependencies, then runs `just lint` and `just test` on Python
3.12 and Node.js 24. Commitlint checks every commit in a push's before-to-after
range and all commits in a pull request's base-to-head range. For a new branch,
the range starts at its common ancestor with the default branch; initial
default-branch pushes and orphan branches include the root commit. Manual runs
check the latest commit. Branch/tag deletion events are skipped. An unavailable
previous tip fails the check rather than silently checking an incomplete range.
The same commitlint configuration is used locally and in CI. CI sets `HUSKY=0`
because it runs checks explicitly.

CI also checks committed whitespace with `git diff --check`: pushes compare the
before/after trees, pull requests compare their merge base to the head, and
initial/orphan histories compare the empty tree to the head. This works on a
clean checkout; local `just lint` retains staged and unstaged whitespace checks.

Workflow files take effect after they are pushed to GitHub. Branch protection
can require the `Lint, tests, and commit messages` check when enabled in repository
settings; this setup does not change remote repository settings.
