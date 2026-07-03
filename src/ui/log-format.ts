import chalk from "chalk"
import wrapAnsi from "wrap-ansi"
import { formatLogsChunk } from "../format.js"

// Framework-agnostic log processing shared by the Ink UI.
// Kept free of React/Ink so it can be unit-tested in isolation.

export interface LogLine {
  number: number // 1-based line number
  raw: string // cleaned raw text (no ANSI, no control chars)
  level: string | null // ERROR | WARN | INFO | ... when detectable
}

const LEVEL_RE = /\b(ERROR|FATAL|WARN|WARNING|INFO|DEBUG|TRACE)\b/i

// Strip control sequences and problematic Unicode so lines render cleanly in a
// terminal cell grid. Runs before syntax highlighting (which re-adds colour/emoji).
export const cleanLogContent = (content: string): string => {
  if (!content) return ""
  return content
    .replace(/\u00A0/g, " ") // non-breaking space
    .replace(/[\u200B\u200C\u200D]/g, "") // zero-width space / non-joiner / joiner
    .replace(/[\u2028\u2029]/g, "\n") // line / paragraph separators
    .replace(/\uFEFF/g, "") // byte order mark
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "") // ANSI/CSI sequences (colour + cursor), ESC-prefixed
    .replace(/\[[0-9;]+m/g, "") // escape-less SGR colour codes (Jenkins consoleText artefact)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "") // control chars (keep \n, \t)
    .replace(/[\uFFFD\uFFFE\uFFFF]/g, "") // replacement / non-characters
    .split("\n")
    .map((line) =>
      line
        .trimEnd()
        // Keep printable ASCII, common Latin/extended ranges, and tabs.
        .replace(
          /[^\x20-\x7E\u00A1-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF\t]/g,
          "",
        ),
    )
    .join("\n")
}

export const extractLogLevel = (line: string): string | null => {
  const m = line.match(LEVEL_RE)
  return m ? m[1].toUpperCase() : null
}

// Split cleaned console text into indexed, level-tagged lines.
export const processLog = (content: string): LogLine[] => {
  const cleaned = cleanLogContent(content)
  if (!cleaned) return []
  return cleaned.split("\n").map((raw, i) => ({
    number: i + 1,
    raw,
    level: extractLogLevel(raw),
  }))
}

// Highlight every case-insensitive occurrence of `query` in a raw line.
// Used during log search — deliberately bypasses syntax highlighting so matches
// stand out unambiguously.
export const highlightMatches = (raw: string, query: string): string => {
  if (!query) return raw
  const q = query.toLowerCase()
  const lower = raw.toLowerCase()
  let out = ""
  let i = 0
  for (;;) {
    const idx = lower.indexOf(q, i)
    if (idx === -1) {
      out += raw.slice(i)
      break
    }
    out +=
      raw.slice(i, idx) + chalk.bgYellow.black(raw.slice(idx, idx + q.length))
    i = idx + q.length
  }
  return out
}

export interface RenderLineOpts {
  showLineNumbers: boolean
  bookmarked: boolean
  searchQuery?: string | null
}

// Produce the final chalk-formatted string for one visible log line, including
// the optional line-number gutter and bookmark marker.
export const renderLogLine = (line: LogLine, opts: RenderLineOpts): string => {
  const body = opts.searchQuery
    ? highlightMatches(line.raw, opts.searchQuery)
    : formatLogsChunk(line.raw)
  if (!opts.showLineNumbers) return body || " "
  const num = chalk.gray(String(line.number).padStart(4, " "))
  const mark = opts.bookmarked ? "📌" : "  "
  return `${num}${mark} ${body}`
}

// Wrap already-rendered (ANSI-coloured) lines to `width`, flattening each into
// one or more visual rows. wrap-ansi keeps colour codes intact across the break.
// Continuation rows are indented to align under the gutter when line numbers show.
export const toVisualLines = (
  rendered: string[],
  width: number,
  gutter = 0,
): string[] => {
  const w = Math.max(1, width)
  const pad = gutter > 0 ? " ".repeat(gutter) : ""
  const out: string[] = []
  for (const line of rendered) {
    const segments = wrapAnsi(line, w, { hard: true, trim: false }).split("\n")
    segments.forEach((seg, i) => out.push(i === 0 ? seg : pad + seg))
  }
  return out
}

// Line indices (0-based) whose raw text contains the query — for n/N navigation.
export const findMatchingLines = (
  lines: LogLine[],
  query: string,
): number[] => {
  if (!query) return []
  const q = query.toLowerCase()
  const res: number[] = []
  lines.forEach((l, i) => {
    if (l.raw.toLowerCase().includes(q)) res.push(i)
  })
  return res
}

// First line index at or after `from` matching a log level (e/W/i jumps), wrapping.
export const firstLineOfLevel = (
  lines: LogLine[],
  level: string,
  from = 0,
): number => {
  const wanted =
    level === "ERROR"
      ? ["ERROR", "FATAL"]
      : level === "WARN"
        ? ["WARN", "WARNING"]
        : [level]
  for (let i = from; i < lines.length; i++) {
    if (lines[i].level && wanted.includes(lines[i].level!)) return i
  }
  for (let i = 0; i < from; i++) {
    if (lines[i].level && wanted.includes(lines[i].level!)) return i
  }
  return -1
}
