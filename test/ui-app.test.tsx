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

test("x on a running build asks to confirm, then aborts it", async () => {
  const stopped: number[] = []
  const runningClient = {
    baseUrl: "http://jenkins.test",
    async listBuilds() {
      return [
        {
          number: 9,
          building: true,
          result: null,
          timestamp: Date.now(),
          duration: 0,
        },
      ]
    },
    async getConsoleText() {
      return "still running…\n" // non-empty so follow does not auto-engage
    },
    async stopBuild(_job: string, n: number) {
      stopped.push(n)
      return { stopped: true }
    },
    async getArtifacts() {
      return { build: {}, artifacts: [] }
    },
    async streamConsole() {},
  } as unknown as JenkinsClient

  const { lastFrame, stdin, unmount } = render(
    <App
      client={runningClient}
      jobSearchLimit={0}
      buildsLimit={10}
      preselectJob="demo"
      jobsFilter={["demo"]}
      singleJobMode={true}
    />,
  )
  await wait(150)
  stdin.write("x") // request abort (builds pane is focused by default in single-job mode)
  await wait(40)
  assert.match(lastFrame() ?? "", /Abort running build #9\?/)
  stdin.write("y") // confirm
  await wait(60)
  assert.deepEqual(stopped, [9])
  unmount()
})

test("logs default to newest-line-first (descending)", async () => {
  const client = {
    baseUrl: "http://jenkins.test",
    async listBuilds() {
      return [
        {
          number: 1,
          building: false,
          result: "SUCCESS",
          timestamp: Date.now(),
          duration: 1,
        },
      ]
    },
    async getConsoleText() {
      return "AAA oldest\nBBB middle\nCCC latest\n"
    },
    async getArtifacts() {
      return { build: {}, artifacts: [] }
    },
    async streamConsole() {},
  } as unknown as JenkinsClient
  const { lastFrame, unmount } = render(
    <App
      client={client}
      jobSearchLimit={0}
      buildsLimit={10}
      preselectJob="demo"
      jobsFilter={["demo"]}
      singleJobMode={true}
    />,
  )
  await wait(150)
  const frame = lastFrame() ?? ""
  // latest line (CCC) must appear above the oldest (AAA)
  assert.ok(
    frame.indexOf("CCC") < frame.indexOf("AAA"),
    "newest line should be above oldest",
  )
  unmount()
})

test("F opens the multi-select status filter modal", async () => {
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
  stdin.write("F")
  await wait(40)
  const frame = lastFrame() ?? ""
  assert.match(frame, /Show build statuses/)
  assert.match(frame, /SUCCESS/)
  assert.match(frame, /FAILURE/)
  assert.match(frame, /\[x\]/) // checkboxes rendered (all on by default)
  unmount()
})

test("? opens the help modal listing keyboard shortcuts", async () => {
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
  stdin.write("?")
  await wait(40)
  const frame = lastFrame() ?? ""
  assert.match(frame, /Keyboard shortcuts/)
  assert.match(frame, /action menu/)
  unmount()
})

test("Enter opens the action menu; selecting Abort routes to the confirm gate", async () => {
  const runningClient = {
    baseUrl: "http://jenkins.test",
    async listBuilds() {
      return [
        {
          number: 9,
          building: true,
          result: null,
          timestamp: Date.now(),
          duration: 0,
        },
      ]
    },
    async getConsoleText() {
      return "still running…\n"
    },
    async getArtifacts() {
      return { build: {}, artifacts: [] }
    },
    async streamConsole() {},
  } as unknown as JenkinsClient

  const { lastFrame, stdin, unmount } = render(
    <App
      client={runningClient}
      jobSearchLimit={0}
      buildsLimit={10}
      preselectJob="demo"
      jobsFilter={["demo"]}
      singleJobMode={true}
    />,
  )
  await wait(150)
  stdin.write("\r") // Enter → action menu
  await wait(40)
  assert.match(lastFrame() ?? "", /Actions —/)
  assert.match(lastFrame() ?? "", /Abort running build/)
  stdin.write("\r") // run first item (Abort, since build is running)
  await wait(40)
  assert.match(lastFrame() ?? "", /Abort running build #9\?/) // routed to confirm gate
  unmount()
})

test("wide log lines stay within the terminal width (no overflow / hard-wrap bleed)", async () => {
  const longTail = "TAILTOKEN_WRAPS_NOT_BLEEDS"
  const longClient = {
    baseUrl: "http://jenkins.test",
    async listBuilds() {
      return [
        {
          number: 1,
          building: false,
          result: "SUCCESS",
          timestamp: Date.now(),
          duration: 1000,
        },
      ]
    },
    async getConsoleText() {
      return `HEAD ${"x".repeat(200)} ${longTail}\n`
    },
    async getArtifacts() {
      return { build: {}, artifacts: [] }
    },
    async streamConsole() {},
  } as unknown as JenkinsClient

  const { lastFrame, unmount } = render(
    <App
      client={longClient}
      jobSearchLimit={0}
      buildsLimit={10}
      preselectJob="demo"
      jobsFilter={["demo"]}
      singleJobMode={true}
    />,
  )
  await wait(150)
  const frame = lastFrame() ?? ""
  // content renders (head of the line is present)
  assert.match(frame, /HEAD/)
  // with wrap on (default) the tail is shown on a continuation row, not clipped
  assert.match(frame, new RegExp(longTail))
  // the invariant that matters: no rendered row exceeds the terminal width, so
  // nothing reaches the screen edge to hard-wrap and bleed into other panels
  const overWide = frame
    .split("\n")
    .filter((row) => row.replace(/\x1b\[[0-9;]*m/g, "").length > 100)
  assert.equal(overWide.length, 0)
  unmount()
})
