import test from "node:test"
import assert from "node:assert/strict"
import { join, resolve } from "node:path"
import {
  sanitizeForTerminal,
  sanitizeDeep,
  terminalCleaner,
  buildOpenUrl,
  openerCommand,
  isValidBuildRef,
  redactToken,
  redactConfig,
  redactRawConfig,
  safeArtifactPath,
} from "../src/safety.js"

const ESC = "\x1b"

test("sanitizeForTerminal strips CSI, OSC and two-character escapes", () => {
  assert.equal(sanitizeForTerminal(`${ESC}[31mred${ESC}[0m`), "red")
  assert.equal(sanitizeForTerminal(`a${ESC}[2J${ESC}[Hb`), "ab")
  assert.equal(sanitizeForTerminal(`${ESC}]0;title\x07after`), "after")
  assert.equal(sanitizeForTerminal(`${ESC}]8;;http://x${ESC}\\link`), "link")
  assert.equal(sanitizeForTerminal(`x${ESC}cy`), "xy")
})

test("sanitizeForTerminal strips DCS/APC string bodies, terminated or not", () => {
  assert.equal(sanitizeForTerminal(`a${ESC}Pq#payload${ESC}\\b`), "ab")
  assert.equal(sanitizeForTerminal(`a${ESC}_apc body\x07b`), "ab")
  assert.equal(sanitizeForTerminal(`a${ESC}]0;never ends`), "a")
})

test("sanitizeForTerminal strips C1 controls including 8-bit CSI and OSC", () => {
  assert.equal(sanitizeForTerminal("a\x9b31mb"), "ab")
  assert.equal(sanitizeForTerminal("a\x9d0;title\x07b"), "ab")
  assert.equal(sanitizeForTerminal("a\x85b\x8ec"), "abc")
  assert.equal(sanitizeForTerminal("a\x9fapc body\x9cb"), "ab")
})

test("sanitizeForTerminal keeps newlines, tabs and printable Unicode", () => {
  assert.equal(sanitizeForTerminal("one\ttwo\nthree ✓ é"), "one\ttwo\nthree ✓ é")
  assert.equal(sanitizeForTerminal("a\r\nb"), "a\nb")
  assert.equal(sanitizeForTerminal("a\rb\x00c\x07d\x7fe"), "abcde")
  assert.equal(sanitizeForTerminal(Buffer.from(`${ESC}[1mx`)), "x")
})

test("sanitizeDeep cleans every nested string and leaves other values", () => {
  const input = {
    name: `job${ESC}[2J`,
    n: 3,
    ok: true,
    none: null,
    list: [{ fileName: `a${ESC}]0;t\x07.txt` }],
  }
  assert.deepEqual(sanitizeDeep(input), {
    name: "job",
    n: 3,
    ok: true,
    none: null,
    list: [{ fileName: "a.txt" }],
  })
  assert.equal(input.name, `job${ESC}[2J`, "input is not mutated")
})

test("terminalCleaner only sanitises when output is a TTY", () => {
  const raw = `${ESC}[31mred`
  assert.equal(terminalCleaner(true).text(raw), "red")
  assert.equal(terminalCleaner(false).text(raw), raw)
  assert.deepEqual(terminalCleaner(true).deep({ a: raw }), { a: "red" })
  assert.deepEqual(terminalCleaner(false).deep({ a: raw }), { a: raw })
})

test("isValidBuildRef accepts digits and permalinks only", () => {
  for (const ok of ["1", "1234", "lastBuild", "lastSuccessfulBuild"])
    assert.equal(isValidBuildRef(ok), true, ok)
  for (const bad of ["", "1a", "-1", "1/../x", 'x"', "last Build", "$(id)"])
    assert.equal(isValidBuildRef(bad), false, bad)
})

test("buildOpenUrl builds job and build URLs", () => {
  assert.equal(
    buildOpenUrl("https://ci.example.com/", "my job"),
    "https://ci.example.com/job/my%20job/",
  )
  assert.equal(
    buildOpenUrl("https://ci.example.com", "j", "42"),
    "https://ci.example.com/job/j/42/",
  )
  assert.equal(
    buildOpenUrl("https://ci.example.com", "j", "lastBuild"),
    "https://ci.example.com/job/j/lastBuild/",
  )
})

test("buildOpenUrl rejects a build reference that is not a number or permalink", () => {
  assert.throws(() => buildOpenUrl("https://ci", "j", '1" & x "'), /Invalid build number/)
  assert.throws(() => buildOpenUrl("https://ci", "j", "1;x"), /Invalid build number/)
})

test("buildOpenUrl rejects non-http(s) base URLs", () => {
  assert.throws(() => buildOpenUrl("file:///etc", "j"), /non-http/)
  assert.throws(() => buildOpenUrl("not a url", "j"), /invalid URL/)
})

test("openerCommand passes the URL as a single argument with no shell", () => {
  const url = "https://ci/job/a%22b/"
  assert.deepEqual(openerCommand("darwin", url), ["open", [url]])
  assert.deepEqual(openerCommand("linux", url), ["xdg-open", [url]])
  const [cmd, args] = openerCommand("win32", url)
  assert.notEqual(cmd, "start")
  assert.notEqual(cmd, "cmd")
  assert.equal(args.at(-1), url)
})

test("redactToken keeps only the last four characters", () => {
  assert.equal(redactToken("abcdef123456"), "****3456")
  assert.equal(redactToken("abc"), "****")
  assert.equal(redactToken(""), "")
  assert.equal(redactToken(undefined), undefined)
})

test("redactConfig redacts tokens at any depth", () => {
  const cfg = {
    url: "https://ci",
    user: "me",
    token: "topsecret-1111",
    servers: { a: { url: "u", user: "x", token: "another-2222" } },
    list: [{ token: "third-3333" }],
  }
  const out = redactConfig(cfg)
  const text = JSON.stringify(out)
  for (const secret of ["topsecret-1111", "another-2222", "third-3333"])
    assert.ok(!text.includes(secret), secret)
  assert.equal(out.token, "****1111")
  assert.equal(out.servers.a.token, "****2222")
  assert.equal(out.url, "https://ci")
})

test("redactRawConfig redacts JSON and hides anything unparseable", () => {
  const raw = JSON.stringify({ token: "topsecret-1111" })
  assert.ok(!redactRawConfig(raw).includes("topsecret"))
  assert.ok(redactRawConfig(raw).includes("****1111"))
  const broken = `{"token":"topsecret-1111"} trailing`
  assert.ok(!redactRawConfig(broken).includes("topsecret"))
})

test("safeArtifactPath keeps ordinary names inside the directory", () => {
  const dir = "/tmp/out"
  assert.equal(safeArtifactPath(dir, "app.jar"), resolve(dir, "app.jar"))
  assert.equal(safeArtifactPath(dir, "sub/app.jar"), join(resolve(dir), "sub", "app.jar"))
  assert.equal(safeArtifactPath(dir, "a..b.txt"), resolve(dir, "a..b.txt"))
})

test("safeArtifactPath rejects absolute paths and .. segments", () => {
  const dir = "/tmp/out"
  for (const bad of [
    "../escape.txt",
    "a/../../escape.txt",
    "..\\escape.txt",
    "/etc/passwd",
    "\\\\host\\share\\x",
    "C:\\Windows\\x",
    "..",
    "",
    ".",
  ])
    assert.throws(() => safeArtifactPath(dir, bad), /Refusing/, JSON.stringify(bad))
})
