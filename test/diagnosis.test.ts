import test from "node:test"
import assert from "node:assert/strict"

const { formatDiagnosis } = await import("../src/format.js")

const sample = {
  job: "acme/api-gateway/feature/login",
  build: 12,
  result: "FAILURE",
  url: "https://ci.example.com/job/acme/job/api-gateway/job/feature%2Flogin/12/",
  failedStages: [
    {
      name: "Unit tests",
      status: "FAILED",
      steps: [
        { name: "npm test", status: "FAILED", logTail: "ok 1\nnot ok 2 - totals\n" },
      ],
    },
  ],
  tests: {
    failed: 3,
    total: 40,
    first: [{ name: "Cart.totals", error: "expected 3 to equal 4\nat x", stackHead: null }],
  },
  hints: ["build still running"],
}

test("formatDiagnosis lists the stage, the step's tail and failed tests", () => {
  const out = formatDiagnosis(sample)
  assert.match(out, /^acme\/api-gateway\/feature\/login #12  FAILURE/)
  assert.match(out, /stage Unit tests  FAILED/)
  assert.match(out, /step  npm test  FAILED\n  ok 1\n  not ok 2 - totals/)
  assert.match(out, /tests 3 failed of 40/)
  assert.match(out, /Cart\.totals\n    expected 3 to equal 4\n/)
  assert.match(out, /… 2 more/)
  assert.match(out, /hint: build still running$/)
})

test("formatDiagnosis says so when nothing failed", () => {
  const out = formatDiagnosis({ ...sample, result: "SUCCESS", failedStages: [], tests: null, hints: [] })
  assert.match(out, /no failing stage or test found/)
})
