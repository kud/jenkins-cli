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
    stripAnsi?: boolean;
    preserveCarriageReturn?: boolean;
}
export declare function sanitizeLogChunk(chunk: string | Buffer, opts?: SanitizeOptions): string;
/** Convenience function for streaming concatenation. */
export declare function sanitizeAndAppend(previous: string, next: string | Buffer, opts?: SanitizeOptions): string;
