import chalk from "chalk"
import hljs from "highlight.js"

const DISABLE_UNICODE_ICONS =
  process.env.JENKINS_CLI_NO_ICONS === "1" ||
  process.env.JENKINS_CLI_PLAIN === "1" ||
  process.env.TERM_PROGRAM === "vscode" ||
  process.env.CI ||
  process.env.TERM === "dumb"
const emojiRegex =
  /✅|❌|⚠\uFE0F|✂\uFE0F|⏰|💥|📄|🏷\uFE0F|💻|🐳|🔧|🔀|🔄|📥|📁|🔨|🔍|⏭\uFE0F|📌|✨|🔥|💀|🐛|🔗|⋯/g
const ICON_FALLBACK: Record<string, string> = {
  "✅": "[OK]",
  "❌": "[X]",
  "⚠\uFE0F": "[!]",
  "✂\uFE0F": "[CUT]",
  "⏰": "[T]",
  "💥": "[ERR]",
  "📄": "[F]",
  "🏷\uFE0F": "[TAG]",
  "💻": "[CMD]",
  "🐳": "[DOCKER]",
  "🔧": "[GIT]",
  "🔀": "[MERGE]",
  "🔄": "[...]",
  "📥": "[DL]",
  "📁": "[DIR]",
  "🔨": "[BUILD]",
  "🔍": "[SRCH]",
  "⏭\uFE0F": "[SKIP]",
  "📌": "[*]",
  "✨": "*",
  "🔥": "[ERR]",
  "💀": "[FATAL]",
  "🐛": "[DBG]",
  "🔗": "[URL]",
  "⋯": "...",
}

// Remove decorative emoji + trailing space. Terminals and `string-width`
// disagree on the cell width of these (variation-selector) glyphs, which floats
// panel borders in the Ink TUI. The interactive log viewer strips them so every
// char is single-width and columns align; the plain CLI keeps them.
export const stripIcons = (s: string): string =>
  s.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]+ ?/gu, "")

const statusColor = (result) => {
  switch (result) {
    case "SUCCESS":
      return chalk.green(result + " ✅")
    case "FAILURE":
      return chalk.red(result + " ❌")
    case "ABORTED":
      return chalk.gray(result + " ✂")
    case "UNSTABLE":
      return chalk.yellow(result + " ⚠")
    default:
      return chalk.cyan(result || "RUNNING")
  }
}

export function formatStatus(build, { pretty = false } = {}) {
  const { number, result, building, duration, estimatedDuration, timestamp } =
    build
  if (pretty) {
    const state = building
      ? chalk.blue("RUNNING")
      : result
        ? statusColor(result)
        : chalk.blue("RUNNING")
    const dur = building
      ? `~${Math.round(duration / 1000)}s`
      : `${Math.round(duration / 1000)}s`
    return `Build #${number}: ${state} (${dur})`
  }
  return `#${number} ${building ? "RUNNING" : result || "UNKNOWN"} duration=${duration}`
}

export function formatBuildList(builds, { pretty = false } = {}) {
  return builds.map((b) => formatStatus(b, { pretty })).join("\n")
}

// Compact millis → human duration for stage graphs (12s, 2m, 1m30s, 1h5m).
const fmtMillis = (ms) => {
  if (ms == null) return ""
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m}m${s % 60}s` : `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h${m % 60}m` : `${h}h`
}

// Per-stage glyph + colour, with an ASCII fallback so the graph survives dumb
// terminals / JENKINS_CLI_NO_ICONS (same philosophy as the icon fallbacks above).
const stageStyle = (status: string) => {
  const ascii = DISABLE_UNICODE_ICONS
  switch ((status || "").toUpperCase()) {
    case "SUCCESS":
      return { icon: ascii ? "[OK]" : "✓", paint: chalk.green }
    case "FAILED":
    case "FAILURE":
      return { icon: ascii ? "[X]" : "✗", paint: chalk.red }
    case "IN_PROGRESS":
    case "RUNNING":
      return { icon: ascii ? "[>]" : "▶", paint: chalk.cyan }
    case "UNSTABLE":
      return { icon: ascii ? "[!]" : "▲", paint: chalk.yellow }
    case "ABORTED":
      return { icon: ascii ? "[-]" : "⊘", paint: chalk.gray }
    case "PAUSED":
      return { icon: ascii ? "[||]" : "⏸", paint: chalk.blue }
    case "NOT_EXECUTED":
    case "SKIPPED":
      return { icon: ascii ? "[ ]" : "○", paint: chalk.dim }
    default:
      return { icon: ascii ? "[?]" : "•", paint: (s: string) => s }
  }
}

// A vertical pipeline flow: one stage per line down a spine, with the status
// glyph coloured and names/durations aligned into columns so many-stage
// pipelines stay scannable (a horizontal flow wraps into an unreadable block).
// `wfapi/describe` gives a flat, linear stage list — parallel branches are not
// distinguished, so this renders the sequence in order.
export function formatPipelineGraph(
  data,
  { color = false, width = 80, label = "Build" } = {},
) {
  const ascii = DISABLE_UNICODE_ICONS
  const paint = (fn, s: string) => (color ? fn(s) : s)
  const overall = stageStyle(data?.status)
  const header = `${label} · ${paint(overall.paint, data?.status || "?")} · ${fmtMillis(data?.durationMillis)}`

  const stages = data?.stages || []
  if (!stages.length)
    return `${header}\n(no stages — not a Declarative/Scripted pipeline build?)`

  const names = stages.map((s) => s.name || "")
  const durs = stages.map((s) => fmtMillis(s.durationMillis))
  const styles = stages.map((s) => stageStyle(s.status))

  // Glyphs are padded to a common width so the name column lines up even with
  // the variable-width ASCII fallbacks ([OK]/[X]/…).
  const glyphW = Math.max(...styles.map((s) => s.icon.length))
  const maxDur = Math.max(0, ...durs.map((d) => d.length))
  // Bound the name column by the terminal so long names don't push durations
  // off-screen; over-long names are ellipsised.
  const reserved = 2 /* spine */ + 1 + glyphW + 1 + 2 /* gaps */ + maxDur
  const nameCap = Math.max(10, width - reserved)
  const nameCol = Math.min(Math.max(0, ...names.map((n) => n.length)), nameCap)
  const ell = ascii ? "." : "…"
  const fitName = (n: string) =>
    n.length > nameCol ? n.slice(0, nameCol - 1) + ell : n.padEnd(nameCol)

  // Spine with a tee off each stage: ┌─ first, ├─ middle, └─ last — every step
  // visibly hangs off a single connected pipeline flowing down.
  const spine = (i: number) => {
    if (stages.length === 1) return ascii ? "--" : "──"
    if (i === 0) return ascii ? "+-" : "┌─"
    if (i === stages.length - 1) return ascii ? "+-" : "└─"
    return ascii ? "|-" : "├─"
  }

  const lines = stages.map((st, i) => {
    const icon = styles[i].icon.padEnd(glyphW)
    // Failure is the one state worth shouting: its whole row goes bold red so a
    // single failed stage is unmissable in a wall of passing ones. Everything
    // else stays glyph-only + grey duration, keeping the list calm.
    const failed = /FAIL/.test(String(st.status).toUpperCase())
    const nameCell = fitName(names[i])
    const glyph = !color
      ? icon
      : failed
        ? chalk.red.bold(icon)
        : styles[i].paint(icon)
    const name = color && failed ? chalk.red.bold(nameCell) : nameCell
    const dur = color && durs[i] ? chalk.gray(durs[i]) : durs[i]
    return `${spine(i)} ${glyph} ${name}  ${dur}`.trimEnd()
  })
  return [header, "", ...lines].join("\n")
}

// A job with no build colour is a folder (or an empty container). Jenkins
// leaf jobs always report a colour (blue/red/…); folders never do.
const isFolder = (job) => job.color === undefined || job.color === null

const jobLabel = (name: string, folder: boolean, color: boolean) => {
  const text = folder ? `${name}/` : name
  if (!color) return text
  return folder ? chalk.blue.bold(text) : text
}

// Flat listing (one full path per line). This is the machine-friendly view —
// used verbatim under a pipe so `list --all | grep mobile` matches full paths.
export function formatJobList(jobs, { color = false } = {}) {
  return jobs
    .map((j) => jobLabel(j.fullName || j.name || "", isFolder(j), color))
    .join("\n")
}

interface JobTreeNode {
  name: string
  color: boolean
  isJob: boolean
  children: Map<string, JobTreeNode>
}

// Reconstruct the folder hierarchy from the flat `fullName` paths. Intermediate
// segments become folder nodes even if their own job entry was omitted (e.g.
// clipped by --limit), so the tree never dangles.
const buildJobTree = (jobs): JobTreeNode => {
  const root: JobTreeNode = {
    name: "",
    color: true,
    isJob: false,
    children: new Map(),
  }
  for (const j of jobs) {
    const parts = (j.fullName || j.name || "").split("/").filter(Boolean)
    let node = root
    parts.forEach((part, idx) => {
      let child = node.children.get(part)
      if (!child) {
        child = { name: part, color: true, isJob: false, children: new Map() }
        node.children.set(part, child)
      }
      if (idx === parts.length - 1) {
        child.isJob = true
        child.color = !isFolder(j)
      }
      node = child
    })
  }
  return root
}

// Human-friendly view: box-drawing tree, folders flagged and (optionally)
// coloured. Used only when stdout is a TTY — never under a pipe.
export function formatJobTree(jobs, { color = false } = {}) {
  const root = buildJobTree(jobs)
  const lines: string[] = []
  const walk = (node: JobTreeNode, prefix: string) => {
    const kids = [...node.children.values()]
    kids.forEach((child, i) => {
      const last = i === kids.length - 1
      const folder = child.children.size > 0 || !child.color
      lines.push(
        prefix + (last ? "└── " : "├── ") + jobLabel(child.name, folder, color),
      )
      walk(child, prefix + (last ? "    " : "│   "))
    })
  }
  walk(root, "")
  return lines.join("\n")
}

export function formatError(err) {
  if (err && (err.status === 401 || err.status === 403)) {
    console.error("Auth error (check user/token permissions)")
  }
  // Friendly guidance for 404s (e.g. user passed only a build number without job)
  if (err && err.status === 404) {
    console.error("Not found (404).")
    console.error("Likely causes:")
    console.error("  - Wrong job name")
    console.error("  - You supplied only a build number but omitted the job")
    console.error("  - Build number does not exist for that job")
    console.error("\nUsage examples:")
    console.error("  jenkins console my-job 123")
    console.error("  jenkins status my-job")
    console.error("  jenkins logs my-job -f")
    console.error("\nTip: format is <job> [buildNumber] or full job/build URL.")
    return
  }
  // Suppress noisy HTML bodies
  const msg = err && err.message ? err.message : String(err)
  if (/<!DOCTYPE html>/i.test(msg)) {
    console.error(msg.split(/</)[0].trim() || "Error (HTML body suppressed)")
  } else {
    console.error(msg)
  }
}

// Convert highlight.js tokens to chalk formatting
const hljs2chalk = (tokens) => {
  return tokens
    .map((token) => {
      if (typeof token === "string") return token

      const className = token.className || ""
      let text = token.value

      // Map highlight.js classes to chalk colors
      switch (className) {
        case "keyword":
          return chalk.blue.bold(text)
        case "built_in":
          return chalk.cyan(text)
        case "string":
          return chalk.green(text)
        case "number":
          return chalk.yellow(text)
        case "comment":
          return chalk.gray.dim(text)
        case "regexp":
          return chalk.magenta(text)
        case "symbol":
          return chalk.yellow(text)
        case "class":
          return chalk.blue(text)
        case "function":
          return chalk.cyan.bold(text)
        case "variable":
          return chalk.white(text)
        case "constant":
          return chalk.yellow.bold(text)
        case "operator":
          return chalk.gray(text)
        case "punctuation":
          return chalk.dim(text)
        case "tag":
          return chalk.blue(text)
        case "attr":
          return chalk.cyan(text)
        case "attribute":
          return chalk.cyan(text)
        case "title":
          return chalk.blue.bold(text)
        case "meta":
          return chalk.gray(text)
        case "section":
          return chalk.magenta.bold(text)
        case "name":
          return chalk.blue(text)
        case "literal":
          return chalk.green(text)
        case "subst":
          return chalk.white(text)
        default:
          return text
      }
    })
    .join("")
}

// Detect code blocks and apply appropriate syntax highlighting
const detectAndHighlightCode = (line) => {
  // Detect common programming languages and formats
  const codePatterns = [
    // JSON
    { pattern: /^\s*[{[].*[}\]]\s*$/, lang: "json" },
    // XML/HTML
    { pattern: /^\s*<[^>]+>.*<\/[^>]+>\s*$/, lang: "xml" },
    // Shell/Bash commands
    { pattern: /^\s*[\$#]\s*\w+/, lang: "bash" },
    // Python
    { pattern: /^\s*(def|class|import|from|if __name__)/i, lang: "python" },
    // JavaScript
    {
      pattern: /^\s*(function|const|let|var|=>|console\.log)/i,
      lang: "javascript",
    },
    // Java
    {
      pattern: /^\s*(public|private|protected|class|import|package)/i,
      lang: "java",
    },
    // SQL
    { pattern: /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)/i, lang: "sql" },
    // Dockerfile
    {
      pattern: /^\s*(FROM|RUN|COPY|ADD|EXPOSE|CMD|ENTRYPOINT)/i,
      lang: "dockerfile",
    },
    // YAML
    { pattern: /^\s*[\w-]+:\s*.+/, lang: "yaml" },
    // Properties
    { pattern: /^\s*[\w.-]+\s*=\s*.+/, lang: "properties" },
  ]

  for (const { pattern, lang } of codePatterns) {
    if (pattern.test(line)) {
      try {
        const result = hljs.highlight(line, {
          language: lang,
          ignoreIllegals: true,
        })
        if (result.relevance > 5) {
          // Only use if confidence is high
          return hljs2chalk([{ value: result.value, className: "highlighted" }])
        }
      } catch (e) {
        // Fall through to manual highlighting if hljs fails
      }
      break
    }
  }

  return null // Let manual highlighting handle it
}

import { sanitizeLogChunk } from "./log-sanitizer.js"

export function formatLogsChunk(chunk) {
  const sanitized = sanitizeLogChunk(chunk, { stripAnsi: true })
  let text = sanitized
  if (DISABLE_UNICODE_ICONS) {
    text = text.replace(emojiRegex, (m) => ICON_FALLBACK[m] || "")
  }
  // Enhanced colouring & comprehensive syntax highlighting with highlight.js
  return text
    .split(/\n/)
    .map((line) => {
      if (!line) return line

      // Jenkins-specific build status messages (highest priority)
      if (/BUILD (SUCCESS|SUCCESSFUL)/i.test(line))
        return chalk.bold.green("✅ " + line)
      if (/BUILD (FAIL|FAILURE|FAILED)/i.test(line))
        return chalk.bold.red("❌ " + line)
      if (/UNSTABLE/i.test(line)) return chalk.bold.yellow("⚠\uFE0F  " + line)
      if (/ABORTED/i.test(line)) return chalk.bold.gray("✂\uFE0F  " + line)

      // Maven/Gradle build phases
      if (/\[INFO\].*--- .* ---/.test(line)) return chalk.bold.cyan(line)
      if (/\[INFO\] BUILD SUCCESS/.test(line))
        return chalk.bold.green("🎉 " + line)
      if (/\[ERROR\] BUILD FAILURE/.test(line))
        return chalk.bold.red("💥 " + line)

      // Test results with enhanced formatting
      if (/Tests run:.*Failures:.*Errors:/.test(line)) {
        return line
          .replace(
            /Tests run: (\d+)/,
            (_m, n) => `Tests run: ${chalk.cyan.bold(n)}`,
          )
          .replace(/Failures: (\d+)/, (_m, n) =>
            n === "0"
              ? `Failures: ${chalk.green.bold(n)}`
              : `Failures: ${chalk.red.bold(n)}`,
          )
          .replace(/Errors: (\d+)/, (_m, n) =>
            n === "0"
              ? `Errors: ${chalk.green.bold(n)}`
              : `Errors: ${chalk.red.bold(n)}`,
          )
          .replace(/Skipped: (\d+)/, (_m, n) =>
            n === "0"
              ? `Skipped: ${chalk.gray(n)}`
              : `Skipped: ${chalk.yellow(n)}`,
          )
      }

      // Try intelligent syntax highlighting first
      const codeHighlighted = detectAndHighlightCode(line)
      if (codeHighlighted) {
        // Add context icons for code blocks
        if (/^\s*[{[]/.test(line)) return "📄 " + codeHighlighted
        if (/^\s*</.test(line)) return "🏷\uFE0F  " + codeHighlighted
        if (/^\s*[\$#]/.test(line)) return "💻 " + codeHighlighted
        return codeHighlighted
      }

      // Docker commands with enhanced detection
      if (/^\s*[\+>]*\s*docker/.test(line)) return chalk.blue("🐳 " + line)
      if (/Successfully built|Successfully tagged|Image.*built/i.test(line))
        return chalk.green("✅ " + line)
      if (/Pulling|Downloading|Extracting/i.test(line))
        return chalk.cyan("📥 " + line)

      // Git operations
      if (/^\s*[\+>]*\s*git/.test(line)) return chalk.magenta("🔧 " + line)
      if (/Cloning into|Clone completed/i.test(line))
        return chalk.cyan("📥 " + line)
      if (/Switched to|Checkout|merge/i.test(line))
        return chalk.blue("🔀 " + line)

      // CI/CD pipeline stages
      if (
        /Stage|Pipeline|Step/i.test(line) &&
        /started|completed|running/i.test(line)
      ) {
        if (/completed|finished|done/i.test(line))
          return chalk.green("✅ " + line)
        if (/started|running|executing/i.test(line))
          return chalk.yellow("🔄 " + line)
        if (/failed|error/i.test(line)) return chalk.red("❌ " + line)
      }

      // File system operations
      if (/^\s*[\+>]*\s*(mkdir|rm|cp|mv|chmod|chown)/.test(line))
        return chalk.gray("📁 " + line)

      // Compilation and build tools
      if (
        /^\s*[\+>]*\s*(npm|yarn|pip|mvn|gradle|make|cargo|go build)/.test(line)
      )
        return chalk.blue("🔨 " + line)

      // Diff style (enhanced)
      if (/^@@ .* @@/.test(line)) return chalk.magenta.bold(line)
      if (/^[+][^+]/.test(line)) return chalk.green("+ " + line.slice(1))
      if (/^-[^-]/.test(line)) return chalk.red("- " + line.slice(1))

      // Enhanced timestamps (multiple formats) with better detection
      line = line.replace(
        /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
        (m) => chalk.dim.gray(`⏰ ${m}`),
      )
      line = line.replace(/^(\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/, (m) =>
        chalk.dim.gray(`⏰ ${m}`),
      )
      line = line.replace(/\[(\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2})\]/, (m) =>
        chalk.dim.gray(`⏰ ${m}`),
      )

      // Enhanced log levels with better regex and icons
      const lvl = line.match(
        /^\s*(?:\[?\s*)?(ERROR|FATAL|WARN|WARNING|INFO|DEBUG|TRACE)\s*(?:\]?\s*[:\-]?\s*)/i,
      )
      if (lvl) {
        const level = lvl[1].toUpperCase()
        const levelFormatted =
          {
            ERROR: chalk.bold.red("🔥 ERROR"),
            FATAL: chalk.bold.bgRed.white("💀 FATAL"),
            WARN: chalk.bold.yellow("⚠\uFE0F  WARN"),
            WARNING: chalk.bold.yellow("⚠\uFE0F  WARNING"),
            INFO: chalk.bold.blue("ℹ\uFE0F  INFO"),
            DEBUG: chalk.gray("🐛 DEBUG"),
            TRACE: chalk.dim.gray("🔍 TRACE"),
          }[level] || chalk.cyan(level)
        line = line.replace(lvl[0], levelFormatted + " ")
      }

      // Enhanced exceptions and stack traces with better detection
      if (
        /Exception|Error:|Traceback|Caused by/i.test(line) &&
        !/INFO|DEBUG/i.test(line)
      ) {
        return chalk.bold.red("💥 " + line)
      }
      if (/^\s*at\s+[\w.$]+\(/.test(line))
        return chalk.dim.red("  ↳ " + line.trim())
      if (/^\s*\.{3}\s*\d+\s+more/i.test(line))
        return chalk.dim.red("  ⋯ " + line.trim())

      // Enhanced JSON formatting with better detection
      if (/^\s*[{[]/.test(line) && /[}\]]\s*$/.test(line)) {
        try {
          const parsed = JSON.parse(line.trim())
          const highlighted = hljs.highlight(JSON.stringify(parsed, null, 2), {
            language: "json",
          }).value
          return "📄 " + hljs2chalk([{ value: highlighted }])
        } catch {
          // Fallback to manual JSON highlighting
          line = line
            .replace(
              /"([^"]+)"\s*:/g,
              (_m, k) => chalk.cyan.bold(`"${k}"`) + ":",
            )
            .replace(/:\s*"([^"]*)"/g, (_m, v) => ": " + chalk.green(`"${v}"`))
            .replace(/:\s*(\d+(?:\.\d+)?)/g, (_m, v) => ": " + chalk.yellow(v))
            .replace(
              /:\s*(true|false|null)/g,
              (_m, v) => ": " + chalk.magenta.bold(v),
            )
            .replace(/[{}]/g, (m) => chalk.white.bold(m))
            .replace(/[\[\]]/g, (m) => chalk.blue.bold(m))
          return "📄 " + line
        }
      }

      // URL detection with better formatting
      line = line.replace(/(https?:\/\/[^\s,]+)/g, (m) =>
        chalk.underline.blue("🔗 " + m),
      )

      // File paths with better detection
      line = line.replace(/([/~][\w/-]*\.[a-zA-Z0-9]{1,4})(?=[\s,]|$)/g, (m) =>
        chalk.cyan("📄 " + m),
      )
      line = line.replace(
        /([A-Za-z]:\\[\w\\-]*\.[a-zA-Z0-9]{1,4})(?=[\s,]|$)/g,
        (m) => chalk.cyan("📄 " + m),
      )

      // Enhanced numbers in context
      line = line.replace(
        /\b(\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?)\s*(?:MB|GB|KB|bytes?|ms|seconds?|minutes?|hours?)\b/gi,
        (m) => chalk.yellow.bold(m),
      )
      line = line.replace(/\b(\d+(?:\.\d+)?)\s*%/g, (m) => chalk.cyan.bold(m))

      // Status indicators with better detection
      line = line.replace(
        /\b(PASS|PASSED|SUCCESS|SUCCESSFUL|OK|DONE|COMPLETE)\b/gi,
        (m) => chalk.green.bold("✅ " + m),
      )
      line = line.replace(/\b(FAIL|FAILED|FAILURE|ERROR)\b/gi, (m) =>
        chalk.red.bold("❌ " + m),
      )
      line = line.replace(/\b(SKIP|SKIPPED|IGNORED|PENDING)\b/gi, (m) =>
        chalk.yellow.bold("⏭\uFE0F  " + m),
      )
      line = line.replace(/\b(WARN|WARNING|CAUTION)\b/gi, (m) =>
        chalk.yellow.bold("⚠\uFE0F  " + m),
      )

      // Progress indicators and ratios
      line = line.replace(
        /(\d+)\/(\d+)(?:\s*\((\d+)%\))?/g,
        (_m, current, total, percent) => {
          const pct =
            percent || ((parseInt(current) / parseInt(total)) * 100).toFixed(0)
          return (
            chalk.cyan(`${current}`) +
            "/" +
            chalk.cyan(`${total}`) +
            chalk.gray(` (${pct}%)`)
          )
        },
      )

      // Generic keyword highlighting (fallback with lower priority)
      if (
        /ERROR|FAILURE/i.test(line) &&
        !line.includes("🔥") &&
        !line.includes("💥")
      ) {
        return chalk.red(line)
      }
      if (/WARN|WARNING/i.test(line) && !line.includes("⚠\uFE0F")) {
        return chalk.yellow(line)
      }
      if (/\bINFO\b/i.test(line) && !line.includes("ℹ\uFE0F")) {
        return chalk.dim(line)
      }

      return line
    })
    .join("\n")
}
