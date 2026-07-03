import test from "node:test"
import assert from "node:assert/strict"
import { render } from "ink-testing-library"
import { App } from "../src/ui/app.js"
import type { JenkinsClient } from "../src/jenkins-client.js"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A stub client covering only what the single-job explorer touches at mount.
const stubClient = () =>
  ({
    baseUrl: "http://jenkins.test",
    async listBuilds() {
      return [
        {
          number: 2,
          building: false,
          result: "SUCCESS",
          timestamp: Date.now() - 1000,
          duration: 5000,
        },
        {
          number: 1,
          building: false,
          result: "FAILURE",
          timestamp: Date.now() - 20000,
          duration: 3000,
        },
      ]
    },
    async getConsoleText() {
      return "starting build\nERROR something broke\nBUILD SUCCESS\n"
    },
    async getArtifacts() {
      return { build: {}, artifacts: [] }
    },
    async streamConsole() {},
  }) as unknown as JenkinsClient

test("App mounts, loads builds, and renders logs (single-job mode)", async () => {
  const { lastFrame, unmount } = render(
    <App
      client={stubClient()}
      jobSearchLimit={0}
      buildsLimit={10}
      preselectJob="demo"
      jobsFilter={["demo"]}
      singleJobMode={true}
    />,
  )
  await wait(150)
  const frame = lastFrame() ?? ""
  assert.match(frame, /Builds/) // builds panel title
  assert.match(frame, /Logs/) // logs panel title
  assert.match(frame, /SUCCESS/) // a build row rendered
  assert.match(frame, /ERROR|broke|BUILD/) // log content rendered
  assert.doesNotMatch(frame, /Jobs/) // jobs panel hidden in single-job mode
  unmount()
})

test("pressing 3 focuses the Logs pane", async () => {
  const { lastFrame, stdin, unmount } = render(
    <App
      client={stubClient()}
      jobSearchLimit={0}
      buildsLimit={10}
      preselectJob="demo"
      jobsFilter={["demo"]}
      singleJobMode={true}
    />,
  )
  await wait(120)
  stdin.write("3")
  await wait(60)
  // focused panel gets a ● marker on its title
  assert.match(lastFrame() ?? "", /Logs ●/)
  unmount()
})
