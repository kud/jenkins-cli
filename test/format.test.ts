import test from "node:test"
import assert from "node:assert/strict"
import chalk from "chalk"
import { formatPipelineGraph } from "../src/format.js"

const sample = {
  status: "FAILED",
  durationMillis: 185000,
  stages: [
    { id: "5", name: "Checkout", status: "SUCCESS", durationMillis: 12000 },
    { id: "7", name: "Build", status: "SUCCESS", durationMillis: 125000 },
    { id: "11", name: "Deploy", status: "FAILED", durationMillis: 8000 },
  ],
}

test("formatPipelineGraph renders a header with label, status and duration", () => {
  const out = formatPipelineGraph(sample, { label: "job #10", width: 80 })
  assert.match(out, /job #10 · FAILED · 3m5s/)
})

test("formatPipelineGraph lists each stage on its own line with glyph + duration", () => {
  const out = formatPipelineGraph(sample, { width: 80 })
  assert.match(out, /✓ Checkout\s+12s/)
  assert.match(out, /✓ Build\s+2m5s/)
  assert.match(out, /✗ Deploy\s+8s/)
  // One line per stage (plus header + blank line).
  const body = out.split("\n").slice(2)
  assert.equal(body.length, sample.stages.length)
})

test("formatPipelineGraph draws a spine with a tee per stage (┌─ ├─ └─)", () => {
  const out = formatPipelineGraph(sample, { width: 80 })
  const body = out.split("\n").slice(2)
  assert.match(body.at(0)!, /^┌─ /)
  assert.match(body.at(1)!, /^├─ /)
  assert.match(body.at(-1)!, /^└─ /)
})

test("formatPipelineGraph ellipsises names too wide for the terminal", () => {
  const wide = {
    status: "SUCCESS",
    durationMillis: 1000,
    stages: [
      {
        name: "A very long declarative stage name that overflows",
        status: "SUCCESS",
        durationMillis: 1000,
      },
    ],
  }
  const out = formatPipelineGraph(wide, { width: 30 })
  assert.match(out, /…/)
})

test("formatPipelineGraph makes a failed stage bold, not the passing ones", () => {
  const prev = chalk.level
  chalk.level = 1 // force ANSI even though the test stdout isn't a TTY
  try {
    const out = formatPipelineGraph(sample, { color: true, width: 80 })
    const line = (name: string) =>
      out.split("\n").find((l) => l.includes(name)) || ""
    assert.ok(line("Deploy").includes("[1m"), "failed row should be bold")
    assert.ok(
      !line("Checkout").includes("[1m"),
      "passing row should not be bold",
    )
  } finally {
    chalk.level = prev
  }
})

test("formatPipelineGraph handles a build with no stages", () => {
  const out = formatPipelineGraph(
    { status: "SUCCESS", durationMillis: 3000, stages: [] },
    { label: "freestyle #4" },
  )
  assert.match(out, /freestyle #4 · SUCCESS · 3s/)
  assert.match(out, /no stages/)
})
