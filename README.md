<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![npm](https://img.shields.io/npm/v/%40kud%2Fjenkins-cli?style=flat-square&color=CB3837)
![MIT](https://img.shields.io/badge/licence-MIT-22C55E?style=flat-square)

**Fast, modern Jenkins CLI + interactive TUI (status, logs, artifacts, search, stream).**

<a href="https://kud.io/projects/jenkins-cli">Website</a> · <a href="https://kud.io/projects/jenkins-cli/docs">Documentation</a>

</div>

## Features

- **Interactive TUI** — full-screen multi-job explorer with build list and live log streaming, built on neo-blessed
- **Log streaming** — follow build console output in real time with `logs -f`; syntax-highlighted via highlight.js
- **Artifact management** — list, filter by pattern, and download build artifacts to a local directory
- **Multi-server profiles** — store named server aliases with separate credentials and switch between them at any time
- **Pipeline stages** — fetch stage-by-stage breakdown of workflow builds via the workflow-api plugin
- **Scriptable output** — every command supports `--json` for raw API data and `--pretty` for colourised terminal output

## Install

```sh
npm install -g @kud/jenkins-cli
```

Binary: `jenkins` · Requires Node.js >= 22

## Usage

```console
$ jenkins config set --url https://jenkins.example.com --user admin --token <api-token>

$ jenkins status my-pipeline
✔ my-pipeline #42  SUCCESS  (2m 14s)

$ jenkins logs my-pipeline --follow
[Pipeline] Start of Pipeline
[Pipeline] node
...

$ jenkins list my-pipeline --limit 5
42  SUCCESS   2m 14s  2026-06-19
41  FAILURE   1m 03s  2026-06-18
40  SUCCESS   2m 08s  2026-06-17

$ jenkins artifacts my-pipeline 42 --output ./downloads

$ jenkins search deploy --limit 10
deploy-prod
deploy-staging
deploy-preview

$ jenkins interactive
```

## Development

```sh
git clone https://github.com/kud/jenkins-cli.git
cd jenkins-cli
npm install
npm run dev
```

| Script          | Purpose                              |
| --------------- | ------------------------------------ |
| `npm run build` | Compile TypeScript to `dist/`        |
| `npm run dev`   | Run directly via tsx (no build step) |
| `npm test`      | Run Node.js built-in test runner     |

📚 **Full documentation → [jenkins-cli/docs](https://kud.io/projects/jenkins-cli/docs)**
