import test from "node:test"
import assert from "node:assert/strict"
import { JenkinsClient } from "../src/jenkins-client.js"

// Mock fetch
const calls = []
const makeResponse = (
  status: number,
  body: any,
  headers: Record<string, string> = {},
) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: "X",
    headers: { get: (k: string) => headers[k.toLowerCase()] },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () =>
      new TextEncoder().encode(
        typeof body === "string" ? body : JSON.stringify(body),
      ),
    clone: () => makeResponse(status, body, headers),
  }) as unknown as Response

global.fetch = (async (url: any, opts: any) => {
  calls.push({ url, opts })
  if (url.includes("/api/json?depth=1")) {
    return makeResponse(
      200,
      {
        lastBuild: { number: 42 },
        builds: [{ number: 42 }, { number: 41 }],
        artifacts: [],
      },
      { "content-type": "application/json" },
    )
  }
  if (url.endsWith("/42/api/json")) {
    return makeResponse(
      200,
      { number: 42, building: false, result: "SUCCESS", artifacts: [] },
      { "content-type": "application/json" },
    )
  }
  if (url.endsWith("/42/consoleText")) {
    return makeResponse(200, "Console output")
  }
  if (url.includes("parameterDefinitions")) {
    return makeResponse(
      200,
      {
        property: [
          {
            parameterDefinitions: [
              {
                name: "BRANCH",
                type: "StringParameterDefinition",
                defaultParameterValue: { value: "main" },
                description: "git branch",
              },
              {
                name: "ENV",
                type: "ChoiceParameterDefinition",
                choices: ["dev", "prod"],
              },
            ],
          },
        ],
      },
      { "content-type": "application/json" },
    )
  }
  if (url.includes("changeSets")) {
    return makeResponse(
      200,
      {
        number: 42,
        actions: [
          {},
          { causes: [{ shortDescription: "Started by user Alice" }] },
        ],
        culprits: [{ fullName: "Bob" }],
        changeSets: [
          {
            items: [
              {
                commitId: "abcdef123456",
                msg: "fix bug",
                author: { fullName: "Carol" },
                date: "2026-07-03",
              },
            ],
          },
        ],
      },
      { "content-type": "application/json" },
    )
  }
  return makeResponse(404, "Not Found")
}) as any

test("getBuild resolves last build when unspecified", async () => {
  const client = new JenkinsClient("http://jenkins", "u", "t")
  const build = await client.getBuild("job-name")
  assert.equal(build.number, 42)
})

test("getConsoleText returns text", async () => {
  const client = new JenkinsClient("http://jenkins", "u", "t")
  const text = await client.getConsoleText("job-name", 42)
  assert.equal(text, "Console output")
})

test("getJobParameters flattens parameter definitions", async () => {
  const client = new JenkinsClient("http://jenkins", "u", "t")
  const defs = await client.getJobParameters("job-name")
  assert.equal(defs.length, 2)
  assert.equal(defs[0].name, "BRANCH")
  assert.equal(defs[0].defaultValue, "main")
  assert.deepEqual(defs[1].choices, ["dev", "prod"])
})

test("getBuildChanges extracts cause, culprits and commits", async () => {
  const client = new JenkinsClient("http://jenkins", "u", "t")
  const info = await client.getBuildChanges("job-name", 42)
  assert.equal(info.number, 42)
  assert.deepEqual(info.causes, ["Started by user Alice"])
  assert.deepEqual(info.culprits, ["Bob"])
  assert.equal(info.commits.length, 1)
  assert.equal(info.commits[0].author, "Carol")
  assert.equal(info.commits[0].msg, "fix bug")
})
