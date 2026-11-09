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
      name: "E2E tests",
      status: "FAILED",
      steps: [
        {
          name: "Shell Script",
          status: "FAILED",
          logTail: "Uploaded report/1.png to s3://acme-ci/1.png\n",
          logLineCount: 1840,
          errorLines: [
            {
              line: 310,
              text: [
                "  ✘ checkout applies the coupon",
                "    applyCoupon failed: 400",
                '    {"message":"Missing cart state: coupon_window"}',
              ],
            },
          ],
        },
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

test("formatDiagnosis shows error blocks before the last lines", () => {
  const out = formatDiagnosis(sample)
  assert.match(out, /^acme\/api-gateway\/feature\/login #12  FAILURE/)
  assert.match(out, /stage E2E tests  FAILED/)
  assert.match(
    out,
    /step  Shell Script  FAILED\n  line 310 of 1,840\n {6}✘ checkout applies the coupon\n[\s\S]*Missing cart state[\s\S]*\n  last lines\n    Uploaded report/,
  )
  assert.match(out, /tests 3 failed of 40/)
  assert.match(out, /Cart\.totals\n    expected 3 to equal 4\n/)
  assert.match(out, /… 2 more/)
  assert.match(out, /hint: build still running$/)
  assert.doesNotMatch(out, /no test report/)
})

test("formatDiagnosis says when a scan found nothing and there is no test report", () => {
  const step = { ...sample.failedStages[0].steps[0], errorLines: [] }
  const out = formatDiagnosis({
    ...sample,
    failedStages: [{ ...sample.failedStages[0], steps: [step] }],
    tests: null,
  })
  assert.match(out, /no error lines found in the step log/)
  assert.match(out, /no test report for this build/)
})

test("formatDiagnosis says so when nothing failed", () => {
  const out = formatDiagnosis({ ...sample, result: "SUCCESS", failedStages: [], tests: null, hints: [] })
  assert.match(out, /no failing stage or test found/)
})
