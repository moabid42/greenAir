# Team development

## Tool versions

Use these development versions, matching CI. The runtime pins select the latest
installed patch within the specified release line.

| Tool | Development version | Configuration |
|---|---|---|
| Node.js | 24 | Root `.nvmrc`; run `nvm install && nvm use` if using nvm |
| Python | 3.12 | `services/backend/.python-version`; uv selects this interpreter |
| uv | 0.13.6 | CI action input; install this version for the same resolver behavior |
| just | 1.46.0 | CI action input |

Run commands from the repository root. `just setup` installs the two locked
dependency sets and activates Git hooks. See [CONTRIBUTING.md](../CONTRIBUTING.md)
for checks and the commit convention. Python's package compatibility range is
broader than the development pin; CI tests the pinned development interpreter.
