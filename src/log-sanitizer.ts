/**
 * Log sanitizer utility.
 *
 * Goals:
 * - Normalize line endings (CRLF -> LF)
 * - Remove stray carriage returns used for in-place updates when not interpreted
 * - Strip ANSI escape sequences when desired (configurable)
 * - Drop other non-printable control characters that blessed renders as '?'
 * - Preserve tabs and newlines
 */

export interface SanitizeOptions {
  stripAnsi?: boolean;      // default true
  preserveCarriageReturn?: boolean; // if true, standalone \r become \n instead of being removed
}

// Regex to match ANSI escape sequences (CSI + OSC + other common)
// Covers: CSI (ESC [ ...), OSC (ESC ] ... BEL/ST), and a few single-char sequences.
const ANSI_PATTERN = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x1B\x07]*(?:\x07|\x1B\\)|[@-Z\\-_])/g;

// Pattern to match literal ANSI codes (when ESC char has been stripped/escaped)
// Matches things like [37m, [1m, [22m, [39m, [0m, etc.
const LITERAL_ANSI_PATTERN = /\[[\d;]*m/g;

// Control chars to remove (keep \n, \t). 0x00-0x1F excluding 0x09 (tab) & 0x0A (LF) & 0x0D handled separately, plus DEL (0x7F)
const CONTROL_PATTERN = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g;

export function sanitizeLogChunk(chunk: string | Buffer, opts: SanitizeOptions = {}): string {
  const { stripAnsi = true, preserveCarriageReturn = false } = opts;
  let s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

  // Normalize CRLF first
  s = s.replace(/\r\n/g, '\n');

  // Handle any remaining standalone CR (progress / spinner updates)
  if (preserveCarriageReturn) {
    // Convert remaining CR to newline so we don't lose intended separation
    s = s.replace(/\r/g, '\n');
  } else {
    // Remove them entirely (acts like terminal overwrite without showing '?')
    s = s.replace(/\r/g, '');
  }

  if (stripAnsi) {
    s = s.replace(ANSI_PATTERN, '');
    // Also strip literal ANSI codes (when ESC has been stripped/escaped)
    s = s.replace(LITERAL_ANSI_PATTERN, '');
  }

  // Remove other control chars that would render as placeholders
  s = s.replace(CONTROL_PATTERN, '');

  return s;
}

/** Convenience function for streaming concatenation. */
export function sanitizeAndAppend(previous: string, next: string | Buffer, opts?: SanitizeOptions) {
  return previous + sanitizeLogChunk(next, opts);
}
