# Jenkins CLI (Interactive + Scriptable)

<p align="center">
  <a href="https://www.npmjs.com/package/@kud/jenkins-cli"><img alt="npm version" src="https://img.shields.io/npm/v/%40kud%2Fjenkins-cli.svg?color=28a745" /></a>
  <a href="https://www.npmjs.com/package/@kud/jenkins-cli"><img alt="downloads" src="https://img.shields.io/npm/dm/%40kud%2Fjenkins-cli.svg" /></a>
  <a href="#license"><img alt="license" src="https://img.shields.io/npm/l/%40kud%2Fjenkins-cli.svg" /></a>
  <a href="https://nodejs.org"><img alt="node version" src="https://img.shields.io/node/v/@kud/jenkins-cli.svg" /></a>
  <!-- Replace ORG/REPO with real slug if desired -->
  <img alt="status" src="https://img.shields.io/badge/CI-placeholder-lightgrey" />
  <img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" />
</p>

> Fast Jenkins terminal companion: rich interactive TUI + focused scripting commands with smart log highlighting & multi‑server profiles. Target: **Node >= 22**, pure **ESM**.

---
## ✨ TL;DR

```bash
# Install (global)
npm i -g @kud/jenkins-cli

# Configure once
jenkins config set --url https://ci.example.com --user alice --token $JENKINS_TOKEN

# See latest build status (pretty)
jenkins status my-pipeline --pretty

# Stream latest logs (follow)
jenkins logs my-pipeline -f

# Launch full-screen explorer (jobs | builds | logs)
jenkins --interactive

# Trigger with parameters
jenkins build my-pipeline --param BRANCH=feature-x --param CACHE=false
```

Need JSON for scripts? Add `--json`. No icons / CI-safe? Set `JENKINS_CLI_PLAIN=1`.

---
## 📚 Table of Contents
- [Features](#-features)
- [Install](#install)
- [Quick Start](#quick-start)
- [Usage Cheat Sheet](#-usage-cheat-sheet)
- [Interactive Explorer](#interactive-explorer)
- [Configuration & Multi-Server](#configuration--multi-server-management)
- [Log Highlighting Magic](#log-formatting--highlighting)
- [Artifacts](#artifacts)
- [Queue & Pipelines](#queue--pipeline-info)
- [Environment Variables](#environment-variables-summary)
- [Programmatic API](#programmatic-usage)
- [Development & Prepublish](#prepublish--development)
- [Why Another CLI?](#why-another-jenkins-cli)
- [Roadmap](#roadmap-ideas)
- [License](#license)

---
## 🚀 Features
- **Unified experience**: quick one-liners + advanced full-screen explorer.
- **Rich log intelligence**: Docker, Git, JSON, diffs, test summaries, timestamps, levels, artifacts & more.
- **Multi-server profiles** with salvage of partially corrupted config.
- **Incremental job traversal** (BFS) with a safety cap (5000) for huge Jenkins instances.
- **Smart emoji fallback** on restricted terminals / CI.
- **Zero heavy deps** — just `commander`, `chalk`, `neo-blessed`, `highlight.js`.
- **Modern**: Node 22+, native fetch, ESM-first.

---
## Install

```bash
npm i -g @kud/jenkins-cli          # Global binary
# or project-local
npm i -D @kud/jenkins-cli
```
Binary: `jenkins`

---
## Quick Start

```bash
jenkins config set --url https://ci.example.com --user alice --token $JENKINS_TOKEN
jenkins list my-job --pretty
jenkins logs my-job -f
jenkins trigger my-job
jenkins artifacts my-job 123 -p .jar -o jars/
```

### Non-Interactive Quick Start
If you see an error like `missing required argument 'jobOrUrl'`, it means the command expects a job name (or a full job/build URL) as the first positional argument.

Common patterns:
```bash
# Latest build status (pretty colors)
jenkins status my-service --pretty

# Follow live logs of latest (or specific) build
jenkins logs my-service -f
jenkins logs my-service 128 -f

# Plain console (same as logs without -f)
jenkins console my-service
jenkins console https://ci.example.com/job/my-service/128/

# List recent builds (limit 20)
jenkins list my-service -l 20
```
`<jobOrUrl>` accepts either:
- A simple job name (folder paths use `/`, e.g. `team/backend-api`)
- A full build URL (`.../job/<name>/<build>/`) or job URL (`.../job/<name>/`)

If the build number is omitted, the CLI resolves the latest build where supported.

Interactive exploration (jobs + builds + logs) still uses either:
```bash
jenkins --interactive            # root flag form
jenkins interactive              # explicit subcommand form
```

---
## 🧾 Usage Cheat Sheet

| Task | Command | Notes |
|------|---------|-------|
| Latest build status | `jenkins status job` | Add `--pretty` for colored state + icon |
| List builds | `jenkins list job -l 15` | Uses latest N builds |
| Stream logs | `jenkins logs job -f` | Progressive API polling |
| Static logs JSON | `jenkins logs job --json` | Outputs `{ text }` |
| Trigger build | `jenkins trigger job` | Plain trigger (no params) |
| Param build | `jenkins build job --param KEY=V --param X=Y` | Repeat flag |
| Stop build | `jenkins stop job 456` | Aborts running build |
| Artifacts list | `jenkins artifacts job 456` | Tab separated list |
| Download artifacts | `jenkins artifacts job 456 -o out/` | All artifacts |
| Filter artifacts | `jenkins artifacts job 456 -p .jar` | Simple substring |
| Test summary | `jenkins test-report job 456` | Add `--json` for details |
| Pipeline stages | `jenkins stages job 456` | Needs workflow-api plugin |
| Queue list | `jenkins queue` | Items with flags |
| Cancel queue | `jenkins queue-cancel 123` | Immediate POST |
| Search jobs | `jenkins search api -l 200` | BFS substring matching |
| Single-job TUI | `jenkins ui job` | Build list + logs |
| Multi-job TUI | `jenkins interactive` | Jobs + builds + logs |

---
## Interactive Explorer

```
+------------------+------------------+-----------------------------------------+
|      Jobs        |      Builds      |                 Logs                    |
|  (filter live)   | (#  State Dur Age)|  syntax highlight / search / follow     |
+------------------+------------------+-----------------------------------------+
|  Status / Key Hints & Active Filters / Pane Focus Indicator / Help (?)        |
+--------------------------------------------------------------------------------
```

### Key Bindings (Core)
| Key | Action | Key | Action |
|-----|--------|-----|--------|
| `q` | Quit | `f` | Toggle follow |
| `r` | Refresh | `S` | Toggle build sort |
| `1/2/3` | Focus pane | `t` | Auto-refresh toggle |
| `←/→` | Cycle panes | `a` | Artifacts popup |
| `/` | Contextual search (jobs or logs) | `c` | Clear filters |
| `b` | Build text filter | `B` | Build fuzzy search |
| `m` | Bookmark line | `M` | Jump to bookmark |
| `e/W/i` | Jump ERROR/WARN/INFO | `g/G` | Top / Bottom |
| `l` | Toggle line numbers | `?` | Help overlay |

### Focus Tricks
- Single job mode: `jenkins interactive --jobs my-service` hides the Jobs panel for more log real estate.
- Emojis auto-replaced in plain terminals (CI, VS Code) → textual tokens.

---
## Configuration & Multi-Server Management
Location: `~/.config/jenkins-cli/config.json` (respects `$XDG_CONFIG_HOME`).

```bash
# Primary server
jenkins config set --url https://ci.example.com --user alice --token $TOKEN

# Multiple servers
jenkins config add-server prod    --url https://ci.example.com        --user alice --token $TOKEN_PROD
jenkins config add-server staging --url https://ci.staging.example.com --user alice --token $TOKEN_STG
jenkins config use staging
jenkins config list-servers
```

Precedence (highest → lowest): **CLI flags** > **Environment variables** > **Config file**.

Salvage logic automatically:
- Truncates trailing garbage past final `}` if file partially corrupted.
- Normalizes markdown links `[text](url)` → `url`.

---
## Log Formatting & Highlighting
Pattern-based enrichment turns plain build text into readable diagnostics.

| Category | Examples Detected | Styling |
|----------|------------------|---------|
| Build Result | `BUILD SUCCESS`, `BUILD FAILURE`, `UNSTABLE` | Colored + icon |
| Test Summary | `Tests run: X Failures: Y Errors: Z` | Numeric color emphasis |
| Tools | `docker pull`, `git clone`, `npm install` | Prefixed icons & color |
| Diffs | `@@ ... @@`, `+added`, `-removed` | Magenta hunk / green / red |
| Levels | `ERROR`, `WARN`, `INFO`, `DEBUG`, `TRACE`, stack traces | Rich labels / dim frames |
| JSON Lines | Single-line JSON objects / arrays | Pretty-highlighted or manual fallback |
| Paths & URLs | `~/file.ts`, `C:\path\a.js`, `https://...` | Cyan / underlined URLs |
| Progress | `31/120 (25%)` or just `31/120` | Recomputed percentage |

Disable icons entirely: `JENKINS_CLI_NO_ICONS=1` (or `JENKINS_CLI_PLAIN=1`).

---
## Artifacts

```bash
# List artifacts of latest build (auto-resolves if number omitted)
jenkins artifacts my-job

# List artifacts for specific build
jenkins artifacts my-job 128

# Download all to directory (creates if missing)
jenkins artifacts my-job 128 -o dist/artifacts

# Filter by substring (.jar) BEFORE downloading
jenkins artifacts my-job 128 -p .jar -o jars/
```

---
## Queue & Pipeline Info
```bash
jenkins queue                 # List queued tasks
jenkins queue-cancel 1234     # Cancel item
jenkins stages my-job 456     # Pipeline stages (needs workflow-api plugin)
jenkins test-report my-job 456 --json  # Full JUnit JSON structure
```

---
## Environment Variables Summary
| Variable | Purpose | Notes |
|----------|---------|-------|
| `JENKINS_URL` | Base URL override | Same as `--url` |
| `JENKINS_USER` | Username override |  |
| `JENKINS_TOKEN` | Token override |  |
| `JENKINS_SERVER` | Server alias | Chosen from config file |
| `JENKINS_TIMEOUT` | Request timeout (ms) | Default 15000 |
| `JENKINS_RETRIES` | Retry attempts (0–9) | Default 0 |
| `JENKINS_CLI_NO_ICONS` | Disable Unicode/emoji | Plain text tokens |
| `JENKINS_CLI_PLAIN` | Same as above |  |
| `JENKINS_CLI_ASCII_SCROLLBAR` | Force ASCII scrollbar | Usually auto-chosen |

---
## Programmatic Usage
Import the client (ESM):

```ts
import { JenkinsClient } from '@kud/jenkins-cli';

const client = new JenkinsClient('https://ci.example.com', 'user', 'token');
const build = await client.getBuild('my-job');
console.log('Result:', build.result);
```

Progressive log stream:
```ts
await client.streamConsole('my-job', 123, chunk => {
  process.stdout.write(chunk); // apply your own formatting if desired
});
```

Search jobs incrementally:
```ts
const jobs = await client.searchJobs('backend', 200); // cap results
for (const j of jobs) console.log(j.fullName || j.name);
```

Download artifact:
```ts
const { artifacts } = await client.getArtifacts('my-job', 123);
for (const a of artifacts) {
  const buf = await client.downloadArtifact('my-job', 123, a.relativePath);
  // write buffer somewhere
}
```

---
## Prepublish / Development
```bash
# Build TS → dist/
npm run build

# Watch mode
npm run dev

# Tests (placeholder for now)
npm test
```
Publishing runs the build automatically via `prepublishOnly`.

---
## Why Another Jenkins CLI?
- Existing CLIs are bulky or incomplete for log exploration.
- Need fast traversal & multi-server context switching.
- Rich real-time log augmentation without external plugins.
- Modern Node (fetch, ESM) keeps surface minimal.

---
## Roadmap Ideas
- In-log match navigation (cursor → exact line for search hits)
- Structured log export (JSON objects: timestamp, level, message)
- Richer pipeline / stage timing visualization
- Inline artifact preview (JSON / text, maybe diff)
- Config encryption for tokens (optional)

> Have a feature idea? Open an issue / PR.

---
## License
MIT

---

---
Happy building! 🛠️
