import test from "node:test"
import assert from "node:assert/strict"

import { resolveListTarget } from "../src/list-target.js"
import { formatChildJobs } from "../src/format.js"

// Hand-written fake client: returns canned data and records every call, so the
// tests assert what query would hit Jenkins without any network access.
const fakeClient = ({
  job,
  builds,
  tree: treeData,
}: {
  job?: any
  builds?: any[]
  tree?: any
} = {}) => {
  const calls = { getJob: [], listBuilds: [], tree: [] }
  return {
    calls,
    getJob: async (j) => {
      calls.getJob.push(j)
      return job
    },
    listBuilds: async (j, limit) => {
      calls.listBuilds.push([j, limit])
      return builds ?? []
    },
    tree: async (path, treeStr) => {
      calls.tree.push([path, treeStr])
      return treeData ?? {}
    },
  }
}

test("a multibranch/folder target lists its child jobs via a tree query", async () => {
  const client = fakeClient({
    job: { name: "frontend-app", jobs: [{ name: "PR-42" }, { name: "main" }] },
    tree: {
      _class: "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
      jobs: [
        { name: "main", color: "blue", lastBuild: { number: 12, result: "SUCCESS" } },
        { name: "PR-42", color: "red", lastBuild: { number: 7, result: "FAILURE" } },
      ],
    },
  })
  const target = await resolveListTarget(client, "acme/frontend-app")
  assert.equal(target.kind, "folder")
  assert.deepEqual(
    target.children.map((c) => c.name),
    ["main", "PR-42"],
  )
  assert.deepEqual(client.calls.getJob, ["acme/frontend-app"])
  // Folder path nests in the URL; leaf children still unreachable before.
  assert.equal(client.calls.tree.length, 1)
  assert.equal(client.calls.tree[0][0], "job/acme/job/frontend-app/api/json")
  // Last-build state is in the query, so the CLI never needs one request per child.
  assert.match(client.calls.tree[0][1], /lastBuild\[number,result\]/)
  assert.deepEqual(client.calls.listBuilds, [], "folder must not fall to builds")
})

test("--limit caps the folder children in the tree query and in the result", async () => {
  const client = fakeClient({
    job: { name: "frontend-app", jobs: [{ name: "PR-42" }, { name: "main" }] },
    tree: {
      jobs: [
        { name: "main", color: "blue" },
        { name: "PR-42", color: "red" },
      ],
    },
  })
  const target = await resolveListTarget(client, "acme/frontend-app", {
    limit: 1,
  })
  assert.equal(target.kind, "folder")
  assert.equal(target.children.length, 1)
  assert.match(client.calls.tree[0][1], /\{0,1\}/)
})

test("a normal job keeps the builds behaviour", async () => {
  const builds = [
    { number: 9, result: "SUCCESS" },
    { number: 8, result: "FAILURE" },
  ]
  const client = fakeClient({
    job: { name: "app", builds: [{ number: 9 }, { number: 8 }] },
    builds,
  })
  const target = await resolveListTarget(client, "app", { limit: 2 })
  assert.equal(target.kind, "job")
  assert.equal(target.builds, builds)
  assert.deepEqual(client.calls.getJob, ["app"])
  assert.deepEqual(client.calls.listBuilds, [["app", 2]])
  assert.deepEqual(client.calls.tree, [])
})

test("a normal job without --limit keeps the default limit of 10", async () => {
  const client = fakeClient({
    job: { name: "app", builds: [{ number: 9 }] },
    builds: [{ number: 9, result: "SUCCESS" }],
  })
  const target = await resolveListTarget(client, "app")
  assert.deepEqual(client.calls.listBuilds, [["app", 10]])
  assert.equal(target.kind, "job")
})

test("a job with no builds yet is still a job, listed as []", async () => {
  const client = fakeClient({ job: { name: "app", builds: [] } })
  const target = await resolveListTarget(client, "app")
  assert.equal(target.kind, "job")
  assert.deepEqual(target.kind === "job" && target.builds, [])
})

test("an empty folder (jobs: []) is a folder with no children, and skips the tree query", async () => {
  const client = fakeClient({ job: { name: "folder", jobs: [] } })
  const target = await resolveListTarget(client, "folder")
  assert.equal(target.kind, "folder")
  assert.deepEqual(target.kind === "folder" && target.children, [])
  assert.deepEqual(client.calls.tree, [])
})

test("formatChildJobs renders name, state and last build number", () => {
  const out = formatChildJobs([
    { name: "main", color: "blue", lastBuild: { number: 12, result: "SUCCESS" } },
    { name: "PR-42", color: "red", lastBuild: { number: 7, result: "FAILURE" } },
    { name: "feature", color: "notbuilt" },
    { name: "running", color: "blue_anime" },
    { name: "sub", fullName: "acme/sub", color: undefined },
  ])
  const lines = out.split("\n")
  assert.equal(lines[0], "main\tSUCCESS\t#12")
  assert.equal(lines[1], "PR-42\tFAILURE\t#7")
  assert.equal(lines[2], "feature\tNOT_BUILT")
  assert.equal(lines[3], "running\tRUNNING")
  // A nested folder child keeps the folder suffix, matching formatJobList.
  assert.equal(lines[4], "acme/sub/\tNOT_BUILT")
})
