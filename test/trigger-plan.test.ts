import test from "node:test"
import assert from "node:assert/strict"
import { planTrigger, parseParams, triggerJob } from "../src/trigger-plan.js"
import type { TriggerPlanClient } from "../src/trigger-plan.js"
import type { JenkinsParameterDefinition } from "@kud/jenkins"

const defs: JenkinsParameterDefinition[] = [
  {
    name: "DEPLOY_TO_QA",
    type: "BooleanParameterDefinition",
    defaultValue: true,
  },
  {
    name: "DEPLOY_TO_UAT",
    type: "BooleanParameterDefinition",
    defaultValue: true,
  },
  {
    name: "DEPLOY_TO_PROD",
    type: "BooleanParameterDefinition",
    defaultValue: true,
  },
  {
    name: "SKIP_TESTS",
    type: "BooleanParameterDefinition",
    defaultValue: false,
  },
  {
    name: "LIB_VERSION",
    type: "StringParameterDefinition",
    defaultValue: "main",
  },
]

const makeClient = (defs: JenkinsParameterDefinition[]) => {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const client: TriggerPlanClient = {
    getJobParameters: async (job) => {
      calls.push({ method: "getJobParameters", args: [job] })
      return defs
    },
    triggerBuild: async (job) => {
      calls.push({ method: "triggerBuild", args: [job] })
      return { queued: true, location: null }
    },
    triggerBuildWithParameters: async (job, params) => {
      calls.push({ method: "triggerBuildWithParameters", args: [job, params] })
      return { queued: true, location: null }
    },
  }
  return { client, calls }
}

test("missing params without --defaults is refused and says nothing was triggered", () => {
  const plan = planTrigger(defs, {}, { useDefaults: false })
  assert.equal(plan.kind, "refuse")
  if (plan.kind !== "refuse") return
  assert.match(plan.message, /DEPLOY_TO_QA/)
  assert.match(plan.message, /DEPLOY_TO_UAT/)
  assert.match(plan.message, /DEPLOY_TO_PROD/)
  assert.match(plan.message, /SKIP_TESTS/)
  assert.match(plan.message, /LIB_VERSION/)
  assert.match(plan.message, /\bBoolean\b/)
  assert.match(plan.message, /\bString\b/)
  assert.doesNotMatch(plan.message, /ParameterDefinition/)
  assert.match(plan.message, /default: true/)
  assert.match(plan.message, /default: false/)
  assert.match(plan.message, /default: main/)
  assert.match(plan.message, /--param LIB_VERSION=VALUE/)
  assert.match(plan.message, /--defaults/)
})

test("all params passed triggers buildWithParameters with exactly those values", async () => {
  const { client, calls } = makeClient(defs)
  const passed = {
    DEPLOY_TO_QA: "true",
    DEPLOY_TO_UAT: "true",
    DEPLOY_TO_PROD: "false",
    SKIP_TESTS: "true",
    LIB_VERSION: "feature-x",
  }
  const plan = planTrigger(defs, passed, {
    useDefaults: false,
  })
  assert.equal(plan.kind, "buildWithParameters")
  assert.deepEqual(plan.params, passed)
  await triggerJob(client, "acme/api-gateway/PR-123", passed, {
    defaults: false,
  })
  assert.deepEqual(calls, [
    { method: "getJobParameters", args: ["acme/api-gateway/PR-123"] },
    {
      method: "triggerBuildWithParameters",
      args: [
        "acme/api-gateway/PR-123",
        {
          DEPLOY_TO_QA: "true",
          DEPLOY_TO_UAT: "true",
          DEPLOY_TO_PROD: "false",
          SKIP_TESTS: "true",
          LIB_VERSION: "feature-x",
        },
      ],
    },
  ])
})

test("refusals never call any trigger method", async () => {
  const { client, calls } = makeClient(defs)
  await assert.rejects(
    triggerJob(client, "acme/api-gateway/PR-123", {}, { defaults: false }),
    /This job has parameters/,
  )
  assert.equal(
    calls.some((c) => c.method.startsWith("triggerBuild")),
    false,
  )
})

test("--defaults with no params passed sends an empty parameter set", async () => {
  const { client, calls } = makeClient(defs)
  await triggerJob(client, "acme/api-gateway/PR-123", {}, { defaults: true })
  assert.equal(calls.length, 2)
  assert.equal(calls[1].method, "triggerBuildWithParameters")
  assert.deepEqual(calls[1].args[1], {})
})

test("--defaults with some params passed sends only those", async () => {
  const { client, calls } = makeClient(defs)
  const passed = { DEPLOY_TO_PROD: "false" }
  await triggerJob(client, "acme/api-gateway/PR-123", passed, {
    defaults: true,
  })
  assert.deepEqual(calls[1].args[1], passed)
})

test("unknown key is refused, with or without --defaults", async () => {
  const { client, calls } = makeClient(defs)
  for (const defaults of [false, true]) {
    await assert.rejects(
      triggerJob(
        client,
        "acme/api-gateway/PR-123",
        { DEPLOY_BETA: "true" },
        {
          defaults,
        },
      ),
      (e: Error) => {
        assert.match(e.message, /Unknown parameter/)
        assert.match(e.message, /DEPLOY_BETA/)
        assert.match(e.message, /Valid parameters: DEPLOY_TO_QA/)
        return true
      },
    )
  }
  assert.equal(
    calls.some((c) => c.method.startsWith("triggerBuild")),
    false,
  )
})

test("unknown key refusal lists the valid parameter names", () => {
  const plan = planTrigger(defs, { NOPE: "x" }, { useDefaults: true })
  assert.equal(plan.kind, "refuse")
  if (plan.kind !== "refuse") return
  for (const name of defs.map((d) => d.name)) {
    assert.match(plan.message, new RegExp(`\\b${name}\\b`))
  }
})

test("job without parameters triggers plain /build", async () => {
  const { client, calls } = makeClient([])
  const res = await triggerJob(client, "acme/api-gateway/main", {}, {})
  assert.deepEqual(res, { queued: true, location: null })
  assert.deepEqual(
    calls.map((c) => c.method),
    ["getJobParameters", "triggerBuild"],
  )
})

test("job without parameters but a --param passed is refused", async () => {
  const { client, calls } = makeClient([])
  await assert.rejects(
    triggerJob(client, "acme/api-gateway/main", { DEPLOY: "true" }, {}),
    /no build parameters/,
  )
  assert.equal(
    calls.some((c) => c.method.startsWith("triggerBuild")),
    false,
  )
})

test("--defaults does not invent parameters for a job with none", async () => {
  const { client, calls } = makeClient([])
  await triggerJob(client, "acme/api-gateway/main", {}, { defaults: true })
  assert.deepEqual(
    calls.map((c) => c.method),
    ["getJobParameters", "triggerBuild"],
  )
})

test("parseParams splits on the first = and rejects bare keys", () => {
  assert.deepEqual(parseParams(["A=1", "B=x=y"]), { A: "1", B: "x=y" })
  assert.throws(() => parseParams(["A"]), /key=value/)
})
