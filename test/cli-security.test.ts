import test from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createServer, type Server } from "node:http"
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// End-to-end checks that run the real CLI against a local stand-in for Jenkins.

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const cli = join(root, "bin", "jenkins-cli.ts")
const ESC = "\x1b"

const sandbox = () => {
  const dir = mkdtempSync(join(tmpdir(), "jenkins-cli-sec-"))
  return {
    dir,
    env: {
      ...process.env,
      HOME: dir,
      XDG_CONFIG_HOME: join(dir, "config"),
      NO_COLOR: "1",
      JENKINS_URL: "",
      JENKINS_USER: "",
      JENKINS_API_TOKEN: "",
      JENKINS_INSTANCES: "",
    },
  }
}

const run = (
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = root,
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((done) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli, ...args], {
      cwd,
      env,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => (stdout += d))
    child.stderr.on("data", (d) => (stderr += d))
    child.on("close", (code) => done({ code, stdout, stderr }))
  })

const serve = (
  handler: (url: string) => { type?: string; body: string | Buffer },
): Promise<{ server: Server; url: string }> =>
  new Promise((done) => {
    const server = createServer((req, res) => {
      const { type = "application/json", body } = handler(req.url || "")
      res.writeHead(200, { "content-type": type })
      res.end(body)
    })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      done({ server, url: `http://127.0.0.1:${port}` })
    })
  })

test("open passes the URL to the opener as one argument, never through a shell", async () => {
  const { dir, env } = sandbox()
  // A fake xdg-open that records the argv it was given.
  const bin = join(dir, "bin")
  const log = join(dir, "argv.log")
  spawnSync("mkdir", ["-p", bin])
  writeFileSync(
    join(bin, "xdg-open"),
    `#!/bin/sh\nprintf '%s\\n' "$#" "$@" > "${log}"\n`,
  )
  chmodSync(join(bin, "xdg-open"), 0o755)
  const marker = join(dir, "marker")
  const envWithBin = { ...env, PATH: `${bin}:${process.env.PATH}` }
  const common = ["--url", "http://127.0.0.1:9", "--user", "u", "--token", "t"]

  // A build argument carrying shell syntax must be rejected outright.
  const bad = await run(
    [...common, "open", "job", `1"; touch "${marker}"; echo "`],
    envWithBin,
  )
  assert.notEqual(bad.code, 0)
  assert.match(bad.stderr, /Invalid build number/)
  assert.equal(existsSync(marker), false, "shell command must not run")

  // A job name with shell metacharacters reaches the opener as data.
  const ok = await run([...common, "open", `a"$(touch ${marker})"b`, "7"], envWithBin)
  assert.equal(ok.code, 0, ok.stderr)
  for (let i = 0; i < 50 && !existsSync(log); i++)
    await new Promise((r) => setTimeout(r, 50))
  assert.equal(existsSync(marker), false, "shell command must not run")
  const [argc, arg] = readFileSync(log, "utf8").split("\n")
  assert.equal(argc, "1")
  assert.equal(arg, ok.stdout.trim())
  assert.match(arg, /^http:\/\/127\.0\.0\.1:9\/job\/a%22%24\(touch.*%22b\/7\/$/)
})

test("--debug-config never prints a full token", async () => {
  const { dir, env } = sandbox()
  const secret = "s3cr3t-token-value-9876"
  const fileSecret = "file-token-secret-5432"
  spawnSync("mkdir", ["-p", join(dir, "config", "jenkins-cli")])
  writeFileSync(
    join(dir, "config", "jenkins-cli", "config.json"),
    JSON.stringify({
      url: "http://127.0.0.1:9",
      user: "u",
      token: fileSecret,
      servers: { other: { url: "http://x", user: "v", token: fileSecret } },
    }),
  )
  const res = await run(
    ["--debug-config", "--timeout", "500", "--token", secret, "status", "job"],
    env,
  )
  assert.match(res.stderr, /debug-config/)
  assert.ok(!res.stderr.includes(secret), "CLI token leaked")
  assert.ok(!res.stderr.includes(fileSecret), "file token leaked")
  assert.ok(res.stderr.includes("****9876"))
  assert.ok(res.stderr.includes("****5432"))
})

test("artifacts --output refuses names that escape the directory", async () => {
  const { dir, env } = sandbox()
  const { server, url } = await serve((path) =>
    path.includes("/artifact/")
      ? { type: "application/octet-stream", body: "payload" }
      : {
          body: JSON.stringify({
            number: 1,
            result: "SUCCESS",
            artifacts: [
              { fileName: "../escaped.txt", relativePath: "escaped.txt" },
              { fileName: "/tmp/abs-escape.txt", relativePath: "abs.txt" },
              { fileName: "good.txt", relativePath: "good.txt" },
            ],
          }),
        },
  )
  try {
    const out = join(dir, "out")
    const res = await run(
      ["--url", url, "--user", "u", "--token", "t", "artifacts", "job", "1", "-o", out],
      env,
    )
    assert.equal(existsSync(join(dir, "escaped.txt")), false)
    assert.equal(readFileSync(join(out, "good.txt"), "utf8"), "payload")
    assert.match(res.stderr, /Refusing/)
    assert.notEqual(res.code, 0, "a refused artifact makes the run fail")
  } finally {
    server.close()
  }
})

test(
  "console output is sanitised on a terminal and kept raw in a pipe",
  { skip: process.platform !== "linux" && "needs util-linux script for a pty" },
  async () => {
    const { env } = sandbox()
    const log = `line one\n${ESC}]0;pwned\x07${ESC}[2Jtwo\x9b31m\n`
    const { server, url } = await serve(() => ({ type: "text/plain", body: log }))
    try {
      const args = ["--url", url, "--user", "u", "--token", "t", "console", "job", "1"]
      // Piped: bytes are untouched so `> file` and grep keep working.
      const piped = await run(args, env)
      assert.equal(piped.stdout, log)

      // On a terminal: run under `script` to get a pty.
      const quoted = [process.execPath, "--import", "tsx", cli, ...args]
        .map((a) => `'${a.replace(/'/g, `'\\''`)}'`)
        .join(" ")
      // Async spawn: the stand-in server runs in this process and must keep
      // answering while the CLI runs.
      const tty = await new Promise<{ status: number | null; stdout: string }>(
        (done) => {
          const child = spawn("script", ["-qec", quoted, "/dev/null"], {
            cwd: root,
            env,
          })
          let stdout = ""
          child.stdout.on("data", (d) => (stdout += d))
          child.on("close", (status) => done({ status, stdout }))
        },
      )
      assert.equal(tty.status, 0, tty.stdout)
      const shown = tty.stdout.replace(/\r\n/g, "\n")
      assert.ok(shown.includes("line one\ntwo\n"), JSON.stringify(shown))
      assert.ok(!shown.includes(`${ESC}]0;`), "OSC must be stripped")
      assert.ok(!shown.includes(`${ESC}[2J`), "CSI must be stripped")
      assert.ok(!shown.includes("\x9b"), "C1 CSI must be stripped")
    } finally {
      server.close()
    }
  },
)
