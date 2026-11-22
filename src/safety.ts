import { isAbsolute, join, relative, resolve } from "node:path"

// Everything a Jenkins server sends back (console logs, job names, descriptions,
// test and artifact names) is text an attacker with commit or job-config access
// can shape. Printed raw to a terminal, escape sequences in it can rewrite the
// screen, retitle the window, plant OSC 8 links or, on some emulators, query
// and inject input. sanitizeForTerminal removes every sequence a terminal would
// act on and keeps only printable text, newlines and tabs.
//
// @kud/jenkins exports sanitizeLogChunk, but it does not cover C1 controls
// (U+0080–U+009F, which include the single-byte CSI and OSC introducers) or the
// bodies of DCS/SOS/PM/APC strings, so the CLI carries its own helper.

// ESC-introduced sequences, longest forms first:
// - CSI: ESC [ params intermediates final
// - OSC / DCS / SOS / PM / APC strings: ESC ] P X ^ _ … terminated by BEL or ST
//   (or left unterminated, in which case the rest of the input is dropped)
// - any other two-character escape (ESC followed by one byte)
const ESC_SEQUENCE =
  /\x1b(?:\[[0-?]*[ -/]*[@-~]?|[\]PX^_][\s\S]*?(?:\x07|\x1b\\|\x9c|$)|[\s\S]?)/g

// C1 string introducers (8-bit OSC, DCS, SOS, PM, APC) with their bodies, then
// the 8-bit CSI with its parameters.
const C1_STRING = /[\x90\x98\x9d\x9e\x9f][\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g
const C1_CSI = /\x9b[0-?]*[ -/]*[@-~]?/g

// Remaining C0 controls except \t and \n, DEL, and the C1 range.
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

export const sanitizeForTerminal = (text: string | Buffer): string => {
  const s = typeof text === "string" ? text : text.toString("utf8")
  return s
    .replace(/\r\n/g, "\n")
    .replace(ESC_SEQUENCE, "")
    .replace(C1_STRING, "")
    .replace(C1_CSI, "")
    .replace(CONTROL, "")
}

// Recursively sanitise every string inside a value (objects, arrays), returning
// a copy. Used on API results before they reach a formatter, so the formatter's
// own colours survive while anything the server supplied is inert.
export const sanitizeDeep = <T>(value: T): T => {
  if (typeof value === "string") return sanitizeForTerminal(value) as T
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v)) as T
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeDeep(v)
    return out as T
  }
  return value
}

// Builds a sanitiser bound to whether output goes to a terminal. Piped output
// and files keep the server's bytes untouched; only a TTY is protected.
export const terminalCleaner = (isTTY: boolean) => ({
  text: (s: string | Buffer): string =>
    isTTY ? sanitizeForTerminal(s) : typeof s === "string" ? s : s.toString("utf8"),
  deep: <T>(v: T): T => (isTTY ? sanitizeDeep(v) : v),
})

// ---------------------------------------------------------------------------
// jenkins open

// Jenkins permalinks accepted in place of a build number.
export const BUILD_PERMALINKS = [
  "lastBuild",
  "lastCompletedBuild",
  "lastSuccessfulBuild",
  "lastStableBuild",
  "lastUnstableBuild",
  "lastFailedBuild",
  "lastUnsuccessfulBuild",
] as const

export const isValidBuildRef = (ref: string): boolean =>
  /^\d+$/.test(ref) || (BUILD_PERMALINKS as readonly string[]).includes(ref)

// The URL handed to the system opener. The build reference is validated, the
// job is percent-encoded, and the result must be a plain http(s) URL so the
// opener never sees a flag-like or non-web argument.
export const buildOpenUrl = (
  baseUrl: string,
  job: string,
  buildRef?: string | null,
): string => {
  if (buildRef != null && buildRef !== "" && !isValidBuildRef(String(buildRef))) {
    throw new Error(
      `Invalid build number '${buildRef}': expected digits or one of ${BUILD_PERMALINKS.join(", ")}`,
    )
  }
  const base = baseUrl.replace(/\/+$/, "")
  const url = buildRef
    ? `${base}/job/${encodeURIComponent(job)}/${buildRef}/`
    : `${base}/job/${encodeURIComponent(job)}/`
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Refusing to open an invalid URL: ${url}`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Refusing to open a non-http(s) URL: ${url}`)
  }
  return parsed.href
}

// The opener program and its argument vector. Passed to execFile, so no shell
// ever parses the URL. On Windows `start` is a cmd.exe built-in, so the URL
// handler is invoked directly instead of going through cmd.
export const openerCommand = (
  platform: NodeJS.Platform,
  url: string,
): [string, string[]] => {
  if (platform === "darwin") return ["open", [url]]
  if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]]
  return ["xdg-open", [url]]
}

// ---------------------------------------------------------------------------
// --debug-config

export const redactToken = (token: unknown): unknown => {
  if (typeof token !== "string" || token === "") return token
  return token.length <= 4 ? "****" : `****${token.slice(-4)}`
}

const SECRET_KEY = /^(token|apitoken|api_token|password|secret)$/i

// Copy of a config-shaped value with every token-like field reduced to its
// last four characters.
export const redactConfig = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map((v) => redactConfig(v)) as T
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? redactToken(v) : redactConfig(v)
    }
    return out as T
  }
  return value
}

// The raw config file, redacted. It is JSON; anything unparseable is not
// echoed, since it may still hold a secret in a shape the redactor misses.
export const redactRawConfig = (raw: string): string => {
  try {
    return JSON.stringify(redactConfig(JSON.parse(raw)), null, 2)
  } catch {
    return `(not valid JSON, ${raw.length} bytes, contents hidden)`
  }
}

// ---------------------------------------------------------------------------
// artifacts --output

// Resolve where an artifact named by the server is written, refusing anything
// that would land outside the chosen directory: absolute paths, drive letters,
// `..` segments, empty names. Both separators are treated as separators so a
// Windows-style name cannot slip through on any platform.
export const safeArtifactPath = (dir: string, name: string): string => {
  if (typeof name !== "string" || name.trim() === "")
    throw new Error("Refusing artifact with an empty name")
  if (name.includes("\0"))
    throw new Error(`Refusing artifact name with a NUL byte`)
  if (isAbsolute(name) || /^[\\/]/.test(name) || /^[a-zA-Z]:/.test(name))
    throw new Error(`Refusing absolute artifact path '${name}'`)
  const segments = name.split(/[\\/]+/)
  if (segments.some((s) => s === ".."))
    throw new Error(`Refusing artifact path with '..' segments '${name}'`)
  const root = resolve(dir)
  const target = resolve(join(root, ...segments.filter((s) => s && s !== ".")))
  const rel = relative(root, target)
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel))
    throw new Error(`Refusing artifact path outside '${dir}': '${name}'`)
  return target
}
