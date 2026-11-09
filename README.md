<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![npm](https://img.shields.io/npm/v/%40kud%2Fjenkins-cli?style=flat-square&color=CB3837)
![MIT](https://img.shields.io/badge/licence-MIT-22C55E?style=flat-square)

**Fast, modern Jenkins CLI + interactive TUI (status, logs, artifacts, search, stream).**

<a href="https://kud.io/projects/jenkins-cli">Website</a> · <a href="https://kud.io/projects/jenkins-cli/docs">Documentation</a>

</div>

## Features

- **Failure diagnosis** — `jenkins why` explains a red build in one screen: each failing stage, the error lines pulled out of its step log, report links, skipped stages folded away
- **Interactive TUI** — a full-screen explorer for jobs, builds and live logs
- **Log streaming** — follow console output in real time, with syntax highlighting
- **Artifacts** — list, filter and download build artifacts
- **Multi-server profiles** — named servers with their own credentials, multibranch jobs included
- **Scriptable** — every command takes `--json`

## Install

```sh
npm install -g @kud/jenkins-cli
```

Binary: `jenkins` · Requires Node.js >= 22

## Usage

```console
$ jenkins why acme/api-gateway/feature/login
acme/api-gateway/feature/login #12  FAILURE

stage Image scan  UNSTABLE  error signal: 3 high vulnerabilities

stage E2E tests  FAILED
step  npm test  FAILED
  line 1 of 15
     FAIL  src/cart.test.ts > applies the coupon
    Error: expected 3 to be 4

    ⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯
     Test Files  1 failed | 4 passed (5)
    chmod 644 out/0
  last lines hidden (--tail to show)

skipped (earlier failure): Deploy

$ jenkins status my-pipeline
✔ my-pipeline #42  SUCCESS  (2m 14s)

$ jenkins logs my-pipeline --follow
$ jenkins interactive
```

<!-- landing:skip -->

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

<!-- landing:/skip -->

📚 **Full documentation → [jenkins-cli/docs](https://kud.io/projects/jenkins-cli/docs)**
