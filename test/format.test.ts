import test from "node:test"
import assert from "node:assert/strict"
import chalk from "chalk"
import { formatPipelineGraph, formatStageRows } from "../src/format.js"

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

test("formatPipelineGraph animates only in-progress stages with runningFrame", () => {
  const data = {
    status: "IN_PROGRESS",
    durationMillis: 90000,
    stages: [
      { name: "Checkout", status: "SUCCESS", durationMillis: 12000 },
      { name: "Build", status: "IN_PROGRESS", durationMillis: 45000 },
    ],
  }
  const out = formatPipelineGraph(data, { width: 60, runningFrame: "⠹" })
  assert.match(out, /⠹ Build/) // running stage shows the frame
  assert.match(out, /✓ Checkout/) // finished stage keeps its glyph
})

test("formatStageRows renders one glyph+name+duration row per item", () => {
  const rows = formatStageRows([
    { name: "Checkout", status: "SUCCESS", durationMillis: 12000 },
    { name: "Deploy", status: "FAILED", durationMillis: 8000 },
  ])
  assert.equal(rows.length, 2)
  assert.match(rows[0], /✓ Checkout\s+12s/)
  assert.match(rows[1], /✗ Deploy\s+8s/)
})

test("formatStageRows bolds only failed rows when coloured", () => {
  const prev = chalk.level
  chalk.level = 1
  try {
    const rows = formatStageRows(
      [
        { name: "Ok", status: "SUCCESS", durationMillis: 1000 },
        { name: "Bad", status: "FAILURE", durationMillis: 1000 },
      ],
      { color: true },
    )
    assert.ok(rows[1].includes("[1m"), "failed row bold")
    assert.ok(!rows[0].includes("[1m"), "passing row not bold")
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
