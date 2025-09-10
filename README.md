# Jenkins CLI (Interactive + Scriptable)

A lightweight, fast, user‑focused Jenkins command line toolkit.

- Zero heavy dependencies (pure fetch + commander + chalk + neo-blessed)
- Works great for both automation (JSON / plain output) and humans (colour / emojis / TUI)
- Multi‑server config with aliases, env override, safe salvage of slightly corrupted config files
- Rich interactive explorer: jobs panel, builds panel, live log viewer with highlighting, search, bookmarks, artifacts
- Progressive log streaming with intelligent formatting of Docker, Git, JSON, build phases, test summaries, stack traces, URLs & file paths
- Resilient traversal & search of large Jenkins instances (incremental BFS with safety cap)

> Target: modern Node (>=22). ES Modules only.

---
## Install

```
npm i -g @kud/jenkins-cli
# or locally
npm i -D @kud/jenkins-cli
```

Binary name: `jenkins`

---
## Quick Start

1. Add credentials (user + API token) and base URL once:

```
jenkins config set --url https://ci.example.com --user alice --token $JENKINS_TOKEN
```

2. Show latest build status:

```
jenkins status my-pipeline --pretty
```

3. Tail logs of most recent build:

```
jenkins logs my-pipeline -f
```

4. Launch full interactive explorer (jobs + builds + logs):

```
jenkins --interactive
# or explicit subcommand
jenkins interactive
```

---
## Configuration & Multi‑Server Management

Stored at: `~/.config/jenkins-cli/config.json` (XDG aware via `$XDG_CONFIG_HOME`).

Commands:

```
jenkins config set --url <url> --user <user> --token <token>
jenkins config show
jenkins config add-server prod --url https://ci.example.com --user alice --token xxx
jenkins config add-server staging --url https://ci.staging.example.com --user alice --token yyy
jenkins config use staging
jenkins config list-servers
jenkins config remove-server staging
```

Environment variable overrides (take precedence when non-empty):
- `JENKINS_URL`
- `JENKINS_USER`
- `JENKINS_TOKEN`
- `JENKINS_SERVER` (alias name)
- `JENKINS_TIMEOUT` (ms)
- `JENKINS_RETRIES`

Config salvage features:
- Truncates trailing garbage after final `}` if file partially corrupted
- Normalises Markdown link style values: `[url](url)` → `url`

---
## Core Commands

```
jenkins status <jobOrUrl> [build]
jenkins list <jobOrUrl> [-l N]
jenkins logs <jobOrUrl> [build] [-f]
jenkins console <jobOrUrl> [build]   # alias of logs (no fancy formatting)
jenkins trigger <jobOrUrl>
jenkins build <job> --param KEY=VAL (repeatable)
jenkins stop <job> <buildNumber>
jenkins queue
jenkins queue-cancel <id>
jenkins test-report <job> <buildNumber>
jenkins stages <job> <buildNumber>
jenkins artifacts <jobOrUrl> [build] [-o dir] [-p pattern]
jenkins open <jobOrUrl> [build]
jenkins search <text> [-l N]
jenkins ui <job> [-l N]              # Single-job TUI
jenkins interactive                  # Multi-job TUI
```

Accepted `<jobOrUrl>` forms:
- `my-job`
- `folder/subfolder/job`
- Full job URL: `https://ci.example.com/job/my-job/`
- Full build URL: `https://ci.example.com/job/my-job/123/`

When a build number is omitted the latest build of the job is used.

Use `--json` for machine readable output where supported, `--pretty` for colourful inline summaries.

---
## Interactive Explorer Highlights

Launch: `jenkins interactive` (or `jenkins --interactive`).

Panels: Jobs | Builds | Logs (+ Metadata bar + Status bar).

Key features:
- Incremental job traversal (handles thousands of jobs; cap 5000 safety)
- Filters: live typing, result filter cycle (ALL/RUNNING/FAILED/SUCCESS), build fuzzy search
- Log viewer: syntax highlighting, emojis (auto‑fallback), search (`/`, then `n` / `N`), line numbers toggle `l`, bookmarks (`m`, list via `M`), jump to levels (`e`, `W`, `i`), jump to top/bottom (`g`, `G`)
- Follow mode for running builds (`f`)
- Artifacts popup (`a`)
- Sorting toggle (`S`), auto-refresh (`t`)
- Open in browser (`w`) when not focused on logs

Scrollbar automatically falls back to ASCII (`|`) if full Unicode is disabled or limited.

### Single Job Mode
```
jenkins interactive --jobs my-job
```
This hides the Jobs panel and focuses Builds + Logs for faster navigation.

### Basic Color / Compatibility Flags
- `--basic-colors` forces 8‑color mode
- `--no-terminfo` suppresses terminfo/tput usage (avoids Setulc warnings on minimal terms)

---
## Log Formatting & Highlighting

Automatic enrichment detects and styles:
- Build state lines (SUCCESS / FAILURE / UNSTABLE / ABORTED)
- Maven / Gradle phases & summaries
- Test result aggregates (tests run, failures, errors, skipped)
- Docker (pull, build, tag) & Git (clone, checkout, merge) commands
- File system operations (mkdir, rm, cp, mv, chmod, chown)
- Common build tools (npm, yarn, pip, mvn, gradle, make, cargo, go build)
- Diff hunks, additions / deletions
- Timestamps (multiple formats) with clock icon
- Log levels (ERROR, FATAL, WARN, INFO, DEBUG, TRACE) with icon + color
- Exceptions / stack frames
- JSON (full parse + pretty highlight when line is standalone JSON)
- URLs, file paths, numbers with units, percentages, progress ratios

Emoji / icon fallback (if terminal lacks support or in CI / VSCode): environment triggers replacement tokens (`[OK]`, `[X]`, etc.).

You can force plain mode with: `JENKINS_CLI_NO_ICONS=1` or `JENKINS_CLI_PLAIN=1`.

---
## Artifacts

List artifacts:
```
jenkins artifacts my-job 123
```
Filter & download all matching to a directory:
```
jenkins artifacts my-job 123 -p .jar -o dist-artifacts
```

---
## Triggering Builds

Simple trigger:
```
jenkins trigger my-job
```
Parameterized:
```
jenkins build my-job --param BRANCH=feature-x --param CACHE=false
```

Stop a running build:
```
jenkins stop my-job 456
```

---
## Queue & Pipeline Info
```
jenkins queue
jenkins queue-cancel 1234
jenkins stages my-job 789
jenkins test-report my-job 789 --json
```

---
## Environment Variables Summary

| Variable | Purpose |
|----------|---------|
| JENKINS_URL | Base URL override |
| JENKINS_USER | Username override |
| JENKINS_TOKEN | API token override |
| JENKINS_SERVER | Server alias to select |
| JENKINS_TIMEOUT | Request timeout (ms) |
| JENKINS_RETRIES | Retry attempts (0-9) |
| JENKINS_CLI_NO_ICONS | Force icon/emoji fallback |
| JENKINS_CLI_PLAIN | Same as above (plain mode) |
| JENKINS_CLI_ASCII_SCROLLBAR | Force ASCII scrollbar (fallback occurs automatically when needed) |

---
## Programmatic Usage

```ts
import { JenkinsClient } from '@kud/jenkins-cli';

const client = new JenkinsClient('https://ci.example.com', 'user', 'token');
const build = await client.getBuild('my-job');
console.log(build.result);
```

Stream logs progressively:
```ts
await client.streamConsole('my-job', 123, chunk => process.stdout.write(chunk));
```

List builds:
```ts
const builds = await client.listBuilds('my-job', 5);
```

Search jobs:
```ts
const jobs = await client.searchJobs('backend');
```

---
## Prepublish / Development

Build TypeScript:
```
npm run build
```

During development (watch):
```
npm run dev
```

Tests (basic placeholders):
```
npm test
```

A `prepublishOnly` script runs the build automatically before `npm publish` (added in package.json).

---
## Why Another Jenkins CLI?
- Lean: no XML parsing madness; uses JSON endpoints
- Fast incremental traversal for huge instances
- Human-friendly log enrichment without requiring Jenkins plugins
- Resilient config salvage + multi-server switching
- Modern Node & ESM focus simplifies dependency stack

---
## Roadmap Ideas
- Richer pipeline visualization (tree / timings)
- Inline artifact preview (text/json)
- Match navigation inside logs (scroll to match position)
- Export logs as structured JSON (level, timestamp, message)
- Optional metrics / caching layer

PRs & issues welcome.

---
## License
MIT
