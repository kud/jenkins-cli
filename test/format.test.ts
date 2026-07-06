import test from "node:test"
import assert from "node:assert/strict"
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

test("formatPipelineGraph shows each stage with its glyph and duration", () => {
  const out = formatPipelineGraph(sample, { width: 80 })
  assert.match(out, /✓ Checkout 12s/)
  assert.match(out, /✓ Build 2m5s/)
  assert.match(out, /✗ Deploy 8s/)
  assert.match(out, /─▶/) // arrow separator between nodes
})

test("formatPipelineGraph wraps to width, keeping every stage", () => {
  const out = formatPipelineGraph(sample, { width: 24 })
  const body = out.split("\n").slice(2) // drop header + blank line
  assert.ok(body.length > 1, "narrow width should span multiple lines")
  for (const stage of ["Checkout", "Build", "Deploy"])
    assert.ok(out.includes(stage), `${stage} must survive wrapping`)
})

test("formatPipelineGraph handles a build with no stages", () => {
  const out = formatPipelineGraph(
    { status: "SUCCESS", durationMillis: 3000, stages: [] },
    { label: "freestyle #4" },
  )
  assert.match(out, /freestyle #4 · SUCCESS · 3s/)
  assert.match(out, /no stages/)
})
