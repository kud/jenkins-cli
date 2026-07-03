# Changelog

All notable changes to this project are documented here.

---

## 1.0.0 — 2026-07-03

The interactive TUI has been rewritten from the ground up on Ink/React, replacing the old neo-blessed screen. This is the headline reason for the 1.0.0 bump — everything else in this release builds on top of that new foundation.

### Highlights

- The interactive UI (`jenkins ui`) is now built on Ink/React instead of neo-blessed, giving the jobs/builds/log panels, search, filters, bookmarks, and auto-refresh a more maintainable and testable foundation. ([c7c8b3a](https://github.com/kud/jenkins-cli/commit/c7c8b3ac52cbf05cc9024e6ef8eff9877f219390))
- Log output now wraps by default with correctly aligned pane borders, instead of relying on Ink's runtime truncation, which used to overflow and corrupt the layout on wide or emoji-heavy lines; press `w` to toggle word-wrap. ([d850c79](https://github.com/kud/jenkins-cli/commit/d850c79ec4ecbdc764772a205ca518c0d8d2b3ed), [251c849](https://github.com/kud/jenkins-cli/commit/251c849b7751e0e8945cbf3eb7517d489814c8ee))
- Pressing `Enter` on a job or build now opens a contextual action menu — abort a running build, trigger a new one, open it in the browser, or view its artifacts — alongside a redesigned split-layout footer showing focus mode and status chips at a glance. ([9acb4ea](https://github.com/kud/jenkins-cli/commit/9acb4ea57f85c937b2c41dd297625492dcf9c678), [d850c79](https://github.com/kud/jenkins-cli/commit/d850c79ec4ecbdc764772a205ca518c0d8d2b3ed))
- Filtering and reading build status just got easier: `F` opens a multi-select modal to tick/untick multiple statuses at once (replacing the old single-filter dropdown), and `S` toggles log order, now defaulting to newest-first. ([c08ab72](https://github.com/kud/jenkins-cli/commit/c08ab72ebc56e3b2f0cc1a6e033e054c1518275e))
- Two new commands round out the CLI: `jenkins params <job>` lists a job's build parameter definitions, and `jenkins changes <job> [buildNumber]` shows what triggered a build and which SCM commits it contains. ([eb76c1d](https://github.com/kud/jenkins-cli/commit/eb76c1d8925364b125fa49fede245d6c83cb5c65))
- Two performance improvements make the UI feel more responsive on busy jobs: recent builds are now fetched in parallel instead of one at a time, and live-following a running build processes only newly-appended log chunks (with cached rendering) instead of re-scanning the whole buffer on every tick. ([1554186](https://github.com/kud/jenkins-cli/commit/15541865d046fadeba5b9ca2d43f1dca76e8b958))

### Fixes

- Multi-width emoji markers and stray variation-selector characters in log lines no longer misalign pane borders — all rendered log output is now sanitised to single-width characters before it reaches the terminal. ([8fec376](https://github.com/kud/jenkins-cli/commit/8fec376b73df27abac29a588b6f5e74d1e4af647))

### Documentation

- The README has been split into a multi-page docs site (interactive UI, usage, configuration, API reference, log highlighting) with a slimmed-down top-level README, aligned with the canonical kud-site structure. ([0b356cf](https://github.com/kud/jenkins-cli/commit/0b356cfcad5331645ce273124d2c0f2d63a46360), [d93073c](https://github.com/kud/jenkins-cli/commit/d93073cd6f49d83be513bc1afd8a12a74a3c2a28), [ab16337](https://github.com/kud/jenkins-cli/commit/ab16337706825e312947297eef40b5152f0d49f0))

### Internal

- Version is now resolved dynamically from `package.json` at runtime instead of being hardcoded, and the compiled `dist/` output is no longer tracked in git. ([d850c79](https://github.com/kud/jenkins-cli/commit/d850c79ec4ecbdc764772a205ca518c0d8d2b3ed))
