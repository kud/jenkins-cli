import test from "node:test";
import assert from "node:assert/strict";
import chalk from "chalk";
// The test runner's stdout is not a TTY, so chalk auto-disables colour. Force
// basic colour so the highlight assertions can observe the ANSI wrapping.
chalk.level = 1;
const { cleanLogContent, processLog, extractLogLevel, findMatchingLines, firstLineOfLevel, highlightMatches, } = await import("../src/ui/log-format.js");
test("cleanLogContent strips ANSI and control chars, normalises newlines", () => {
    const dirty = "\x1b[31mred\x1b[0m\r\nsecond\rthird";
    assert.equal(cleanLogContent(dirty), "red\nsecond\nthird");
});
test("processLog indexes lines from 1 and tags levels", () => {
    const lines = processLog("starting up\nERROR boom\nall good");
    assert.equal(lines.length, 3);
    assert.equal(lines[0].number, 1);
    assert.equal(lines[1].level, "ERROR");
    assert.equal(lines[2].level, null);
});
test("extractLogLevel normalises case and aliases", () => {
    assert.equal(extractLogLevel("a warning here"), "WARNING");
    assert.equal(extractLogLevel("nothing"), null);
});
test("findMatchingLines returns 0-based indices, case-insensitive", () => {
    const lines = processLog("foo\nBAR baz\nqux bar");
    assert.deepEqual(findMatchingLines(lines, "bar"), [1, 2]);
    assert.deepEqual(findMatchingLines(lines, ""), []);
});
test("firstLineOfLevel finds ERROR (incl. FATAL) and wraps around", () => {
    const lines = processLog("info a\nFATAL b\ninfo c");
    assert.equal(firstLineOfLevel(lines, "ERROR", 0), 1);
    // searching from after the match wraps back to it
    assert.equal(firstLineOfLevel(lines, "ERROR", 2), 1);
    assert.equal(firstLineOfLevel(lines, "WARN", 0), -1);
});
test("highlightMatches wraps every occurrence and leaves misses untouched", () => {
    const out = highlightMatches("abcABCabc", "abc");
    // 3 case-insensitive occurrences → 3 highlight open sequences
    const opens = out.split("\x1b[43m").length - 1;
    assert.equal(opens, 3);
    assert.equal(highlightMatches("nothing", "xyz"), "nothing");
});
