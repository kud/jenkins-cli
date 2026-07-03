import chalk from 'chalk';
import { formatLogsChunk } from '../format.js';
const LEVEL_RE = /\b(ERROR|FATAL|WARN|WARNING|INFO|DEBUG|TRACE)\b/i;
// Strip control sequences and problematic Unicode so lines render cleanly in a
// terminal cell grid. Runs before syntax highlighting (which re-adds colour/emoji).
export const cleanLogContent = (content) => {
    if (!content)
        return '';
    return content
        .replace(/\u00A0/g, ' ') // non-breaking space
        .replace(/[\u200B\u200C\u200D]/g, '') // zero-width space / non-joiner / joiner
        .replace(/[\u2028\u2029]/g, '\n') // line / paragraph separators
        .replace(/\uFEFF/g, '') // byte order mark
        .replace(/\x1b\[[0-9;]*m/g, '') // ANSI colour codes
        .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') // other ANSI/cursor sequences
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '') // control chars (keep \n, \t)
        .replace(/[\uFFFD\uFFFE\uFFFF]/g, '') // replacement / non-characters
        .split('\n')
        .map((line) => line
        .trimEnd()
        // Keep printable ASCII, common Latin/extended ranges, and tabs.
        .replace(/[^\x20-\x7E\u00A1-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF\t]/g, ''))
        .join('\n');
};
export const extractLogLevel = (line) => {
    const m = line.match(LEVEL_RE);
    return m ? m[1].toUpperCase() : null;
};
// Split cleaned console text into indexed, level-tagged lines.
export const processLog = (content) => {
    const cleaned = cleanLogContent(content);
    if (!cleaned)
        return [];
    return cleaned.split('\n').map((raw, i) => ({
        number: i + 1,
        raw,
        level: extractLogLevel(raw),
    }));
};
// Highlight every case-insensitive occurrence of `query` in a raw line.
// Used during log search — deliberately bypasses syntax highlighting so matches
// stand out unambiguously.
export const highlightMatches = (raw, query) => {
    if (!query)
        return raw;
    const q = query.toLowerCase();
    const lower = raw.toLowerCase();
    let out = '';
    let i = 0;
    for (;;) {
        const idx = lower.indexOf(q, i);
        if (idx === -1) {
            out += raw.slice(i);
            break;
        }
        out += raw.slice(i, idx) + chalk.bgYellow.black(raw.slice(idx, idx + q.length));
        i = idx + q.length;
    }
    return out;
};
// Produce the final chalk-formatted string for one visible log line, including
// the optional line-number gutter and bookmark marker.
export const renderLogLine = (line, opts) => {
    const body = opts.searchQuery ? highlightMatches(line.raw, opts.searchQuery) : formatLogsChunk(line.raw);
    if (!opts.showLineNumbers)
        return body || ' ';
    const num = chalk.gray(String(line.number).padStart(4, ' '));
    const mark = opts.bookmarked ? '📌' : '  ';
    return `${num}${mark} ${body}`;
};
// Line indices (0-based) whose raw text contains the query — for n/N navigation.
export const findMatchingLines = (lines, query) => {
    if (!query)
        return [];
    const q = query.toLowerCase();
    const res = [];
    lines.forEach((l, i) => {
        if (l.raw.toLowerCase().includes(q))
            res.push(i);
    });
    return res;
};
// First line index at or after `from` matching a log level (e/W/i jumps), wrapping.
export const firstLineOfLevel = (lines, level, from = 0) => {
    const wanted = level === 'ERROR' ? ['ERROR', 'FATAL'] : level === 'WARN' ? ['WARN', 'WARNING'] : [level];
    for (let i = from; i < lines.length; i++) {
        if (lines[i].level && wanted.includes(lines[i].level))
            return i;
    }
    for (let i = 0; i < from; i++) {
        if (lines[i].level && wanted.includes(lines[i].level))
            return i;
    }
    return -1;
};
