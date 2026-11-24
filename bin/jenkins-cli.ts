#!/usr/bin/env node
// React reads NODE_ENV once, when it loads: set it before anything imports
// react or ink, and never override an explicit value.
process.env.NODE_ENV ??= "production"

await import("./main.js")
