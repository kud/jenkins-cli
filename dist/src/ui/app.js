import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import chalk from "chalk";
import { exec } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findMatchingLines, firstLineOfLevel, processLog, renderLogLine, } from "./log-format.js";
import { LogView, Panel, ScrollList, StatusBar } from "./components.js";
const RESULT_FILTERS = ["ALL", "RUNNING", "FAILED", "SUCCESS"];
const AUTO_REFRESH_MS = 10000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const buildState = (b) => b.building ? "RUNNING" : b.result || "UNKNOWN";
const fmtDuration = (b) => {
    const d = b.building
        ? Date.now() - (b.timestamp || Date.now())
        : b.duration || 0;
    if (d < 1000)
        return `${d}ms`;
    if (d < 60000)
        return `${Math.round(d / 1000)}s`;
    if (d < 3600000)
        return `${Math.round(d / 60000)}m`;
    return `${Math.round(d / 3600000)}h`;
};
const fmtAge = (b) => {
    if (!b.timestamp)
        return "-";
    const ms = Date.now() - b.timestamp;
    if (ms < 60000)
        return `${Math.max(1, Math.round(ms / 1000))}s ago`;
    if (ms < 3600000)
        return `${Math.round(ms / 60000)}m ago`;
    if (ms < 86400000)
        return `${Math.round(ms / 3600000)}h ago`;
    return `${Math.round(ms / 86400000)}d ago`;
};
const pad = (s, len) => s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
// One coloured build row: "#num  STATE  dur  age".
const colorizeBuild = (b) => {
    const state = buildState(b);
    const paint = state === "RUNNING"
        ? chalk.yellow
        : state === "SUCCESS"
            ? chalk.green
            : state === "FAILURE"
                ? chalk.red
                : state === "UNSTABLE"
                    ? chalk.magenta
                    : state === "ABORTED"
                        ? chalk.cyan
                        : chalk.white;
    return paint(`${pad(`#${b.number}`, 7)} ${pad(state, 9)} ${pad(fmtDuration(b), 6)} ${pad(fmtAge(b), 8)}`);
};
const useTermSize = () => {
    const { stdout } = useStdout();
    const [size, setSize] = useState({
        cols: stdout.columns || 80,
        rows: stdout.rows || 24,
    });
    useEffect(() => {
        const onResize = () => setSize({ cols: stdout.columns || 80, rows: stdout.rows || 24 });
        stdout.on("resize", onResize);
        return () => {
            stdout.off("resize", onResize);
        };
    }, [stdout]);
    return size;
};
const openInBrowser = (url) => {
    const opener = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
            ? "start"
            : "xdg-open";
    exec(`${opener} "${url}"`);
};
export const App = ({ client, jobSearchLimit, buildsLimit, preselectJob, jobsFilter, singleJobMode, }) => {
    const { exit } = useApp();
    const { cols, rows } = useTermSize();
    // ---- layout maths (fullscreen) ------------------------------------------
    const bodyHeight = Math.max(3, rows - 3); // minus status bar
    const jobsWidth = singleJobMode ? 0 : Math.max(16, Math.floor(cols * 0.2));
    const buildsWidth = singleJobMode
        ? Math.max(20, Math.floor(cols * 0.3))
        : Math.max(16, Math.floor(cols * 0.2));
    const metadataHeight = 4;
    const logRows = Math.max(1, bodyHeight - metadataHeight - 3); // 2 border + 1 title
    const listRows = Math.max(1, bodyHeight - 3);
    const logRowsRef = useRef(logRows);
    logRowsRef.current = logRows;
    // ---- data state ----------------------------------------------------------
    const [jobs, setJobs] = useState(singleJobMode && jobsFilter
        ? [{ name: jobsFilter[0], fullName: jobsFilter[0] }]
        : []);
    const [jobSel, setJobSel] = useState(0);
    const [jobQuery, setJobQuery] = useState("");
    const [foldersOnly, setFoldersOnly] = useState(false);
    const [builds, setBuilds] = useState([]);
    const [buildSel, setBuildSel] = useState(0);
    const [buildQuery, setBuildQuery] = useState("");
    const [resultFilterIdx, setResultFilterIdx] = useState(0);
    const [sortAsc, setSortAsc] = useState(false);
    const [logLines, setLogLines] = useState([]);
    const [logScroll, setLogScroll] = useState(0);
    const [showLineNumbers, setShowLineNumbers] = useState(true);
    const [bookmarks, setBookmarks] = useState([]); // line indices
    const [logSearchApplied, setLogSearchApplied] = useState("");
    const [logMatches, setLogMatches] = useState([]);
    const [logMatchIdx, setLogMatchIdx] = useState(-1);
    const [follow, setFollow] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [focus, setFocus] = useState(singleJobMode ? "builds" : "jobs");
    const [mode, setMode] = useState(null);
    const [draft, setDraft] = useState(""); // live text for the active mode
    const [overlay, setOverlay] = useState(null);
    const [artifacts, setArtifacts] = useState([]);
    const [artifactSel, setArtifactSel] = useState(0);
    const [status, setStatus] = useState("Initializing…");
    const [tick, setTick] = useState(0); // manual/auto refresh trigger
    const jobLimitRef = useRef(jobSearchLimit);
    const abortRef = useRef(null);
    const rawRef = useRef("");
    const lastRenderRef = useRef(0);
    const preselectDone = useRef(false);
    // ---- derived: filtered lists --------------------------------------------
    const filteredJobs = useMemo(() => {
        let list = jobs;
        if (jobQuery) {
            const q = jobQuery.toLowerCase();
            list = list.filter((j) => (j.fullName || j.name || "").toLowerCase().includes(q));
        }
        if (foldersOnly)
            list = list.filter((j) => (j.fullName || j.name || "").includes("/"));
        return list;
    }, [jobs, jobQuery, foldersOnly]);
    const filteredBuilds = useMemo(() => {
        const base = builds
            .slice()
            .sort((a, b) => (sortAsc ? a.number - b.number : b.number - a.number));
        const rf = RESULT_FILTERS[resultFilterIdx];
        const byResult = base.filter((b) => {
            const state = buildState(b);
            if (rf === "FAILED")
                return state === "FAILURE";
            if (rf === "SUCCESS")
                return state === "SUCCESS";
            if (rf === "RUNNING")
                return state === "RUNNING";
            return true;
        });
        if (!buildQuery)
            return byResult;
        const q = buildQuery.toLowerCase();
        return byResult.filter((b) => `#${b.number} ${buildState(b)}`.toLowerCase().includes(q));
    }, [builds, sortAsc, resultFilterIdx, buildQuery]);
    const currentJob = singleJobMode && jobsFilter
        ? jobsFilter[0]
        : (filteredJobs[jobSel]?.name ?? null);
    const currentJobObj = singleJobMode ? null : (filteredJobs[jobSel] ?? null);
    const selectedBuild = filteredBuilds[buildSel] ?? null;
    const selectedBuildNumber = selectedBuild?.number ?? null;
    // keep selections in range as filters shrink lists
    useEffect(() => {
        if (jobSel >= filteredJobs.length)
            setJobSel(0);
    }, [filteredJobs.length, jobSel]);
    useEffect(() => {
        if (buildSel >= filteredBuilds.length)
            setBuildSel(0);
    }, [filteredBuilds.length, buildSel]);
    const maxLogScroll = Math.max(0, logLines.length - logRows);
    useEffect(() => {
        setLogScroll((s) => clamp(s, 0, maxLogScroll));
    }, [maxLogScroll]);
    // ---- load jobs -----------------------------------------------------------
    const loadJobs = useCallback(async () => {
        if (singleJobMode)
            return;
        setStatus("Loading jobs…");
        try {
            if (jobsFilter && jobsFilter.length) {
                setJobs(await client.getSpecificJobs(jobsFilter));
            }
            else {
                await client.searchJobsIncremental("", {
                    limit: jobLimitRef.current,
                    onBatch: (list) => setJobs(list.slice()),
                });
            }
            setStatus("Jobs loaded");
        }
        catch (e) {
            setStatus(`Job load error: ${e.message}`);
        }
    }, [client, jobsFilter, singleJobMode]);
    useEffect(() => {
        void loadJobs();
    }, [loadJobs]);
    // preselect a job once jobs are present
    useEffect(() => {
        if (preselectDone.current ||
            !preselectJob ||
            singleJobMode ||
            !filteredJobs.length)
            return;
        const idx = filteredJobs.findIndex((j) => j.name === preselectJob);
        if (idx >= 0) {
            setJobSel(idx);
            preselectDone.current = true;
        }
    }, [filteredJobs, preselectJob, singleJobMode]);
    // ---- load builds when the current job changes ---------------------------
    useEffect(() => {
        if (!currentJob)
            return;
        if (currentJobObj?.error) {
            setBuilds([]);
            setLogLines([]);
            setStatus(chalk.red(`Job error: ${currentJobObj.error}`));
            return;
        }
        let cancelled = false;
        setStatus(`Loading builds for ${currentJob}…`);
        client
            .listBuilds(currentJob, buildsLimit)
            .then((bs) => {
            if (cancelled)
                return;
            setBuilds(bs);
            setBuildSel(0);
            setStatus(bs.length
                ? chalk.green(`Builds loaded (${bs.length})`)
                : chalk.yellow(`No builds for ${currentJob}`));
        })
            .catch((e) => {
            if (!cancelled) {
                setBuilds([]);
                setStatus(chalk.red(`Build load error: ${e.message}`));
            }
        });
        return () => {
            cancelled = true;
        };
    }, [client, currentJob, currentJobObj?.error, buildsLimit, tick]);
    // ---- load / follow logs when the selected build changes -----------------
    useEffect(() => {
        if (!currentJob || selectedBuildNumber == null) {
            setLogLines([]);
            return;
        }
        const ac = new AbortController();
        abortRef.current?.abort();
        abortRef.current = ac;
        rawRef.current = "";
        setLogLines([]);
        setLogScroll(0);
        let cancelled = false;
        const building = selectedBuild?.building === true;
        const applyRaw = (bottom) => {
            const lines = processLog(rawRef.current);
            setLogLines(lines);
            if (bottom)
                setLogScroll(Math.max(0, lines.length - logRowsRef.current));
        };
        const runFollow = async () => {
            setStatus(chalk.cyan(`Following build #${selectedBuildNumber}…`));
            try {
                await client.streamConsole(currentJob, selectedBuildNumber, (chunk) => {
                    rawRef.current += chunk;
                    const now = Date.now();
                    if (now - lastRenderRef.current > 150) {
                        lastRenderRef.current = now;
                        applyRaw(true);
                    }
                }, 2000, { signal: ac.signal });
                if (!ac.signal.aborted) {
                    applyRaw(true);
                    setStatus(chalk.green(`Build #${selectedBuildNumber} complete`));
                }
            }
            catch (e) {
                if (e.name !== "AbortError")
                    setStatus(chalk.red(`Follow error: ${e.message}`));
            }
        };
        (async () => {
            if (follow && building) {
                await runFollow();
                return;
            }
            setStatus(`Fetching logs #${selectedBuildNumber}…`);
            try {
                const text = await client.getConsoleText(currentJob, selectedBuildNumber);
                if (cancelled)
                    return;
                if (!text || !text.trim()) {
                    if (building) {
                        setFollow(true); // re-runs this effect in follow mode
                        return;
                    }
                    setLogLines([]);
                    setStatus(chalk.gray("No console output"));
                    return;
                }
                rawRef.current = text;
                const lines = processLog(text);
                setLogLines(lines);
                setLogScroll(Math.max(0, lines.length - logRowsRef.current));
                const errors = lines.filter((l) => l.level === "ERROR" || l.level === "FATAL").length;
                const warns = lines.filter((l) => l.level === "WARN" || l.level === "WARNING").length;
                setStatus(chalk.green(`Logs loaded — ${lines.length} lines`) +
                    (errors ? chalk.red(` ${errors} err`) : "") +
                    (warns ? chalk.yellow(` ${warns} warn`) : ""));
            }
            catch (e) {
                if (!cancelled) {
                    setLogLines([]);
                    setStatus(chalk.red(`Log error: ${e.message}`));
                }
            }
        })();
        return () => {
            cancelled = true;
            ac.abort();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, currentJob, selectedBuildNumber, follow, tick]);
    // ---- auto-refresh --------------------------------------------------------
    useEffect(() => {
        if (!autoRefresh)
            return;
        const id = setInterval(() => setTick((t) => t + 1), AUTO_REFRESH_MS);
        return () => clearInterval(id);
    }, [autoRefresh]);
    // ---- log navigation helpers ---------------------------------------------
    const scrollLog = (delta) => setLogScroll((s) => clamp(s + delta, 0, maxLogScroll));
    const jumpToLevel = (level) => {
        const idx = firstLineOfLevel(logLines, level, logScroll + 1);
        if (idx < 0) {
            setStatus(chalk.yellow(`No ${level} lines`));
            return;
        }
        setLogScroll(clamp(idx, 0, maxLogScroll));
        setStatus(chalk.green(`Jumped to ${level} @ line ${idx + 1}`));
    };
    const toggleBookmark = () => {
        const line = logScroll; // bookmark the top visible line
        setBookmarks((bm) => bm.includes(line)
            ? bm.filter((x) => x !== line)
            : [...bm, line].sort((a, b) => a - b));
        setStatus(chalk.green(`Bookmark toggled @ line ${line + 1}`));
    };
    const nextBookmark = () => {
        if (!bookmarks.length) {
            setStatus(chalk.yellow("No bookmarks — press m to add one"));
            return;
        }
        const next = bookmarks.find((b) => b > logScroll) ?? bookmarks[0];
        setLogScroll(clamp(next, 0, maxLogScroll));
        setStatus(chalk.green(`Bookmark ${bookmarks.indexOf(next) + 1}/${bookmarks.length} @ line ${next + 1}`));
    };
    const gotoMatch = (dir) => {
        if (!logMatches.length)
            return;
        const i = clamp(logMatchIdx + dir, 0, logMatches.length - 1);
        const wrapped = logMatchIdx + dir < 0
            ? logMatches.length - 1
            : logMatchIdx + dir >= logMatches.length
                ? 0
                : i;
        setLogMatchIdx(wrapped);
        setLogScroll(clamp(logMatches[wrapped], 0, maxLogScroll));
        setStatus(chalk.green(`Match ${wrapped + 1}/${logMatches.length}`));
    };
    const openWeb = () => {
        if (!currentJob) {
            setStatus("No job selected");
            return;
        }
        const base = client.baseUrl.replace(/\/$/, "");
        if (focus === "builds" && selectedBuild) {
            openInBrowser(`${base}/job/${encodeURIComponent(currentJob)}/${selectedBuild.number}/`);
            setStatus(`Opening build #${selectedBuild.number}…`);
        }
        else {
            openInBrowser(`${base}/job/${encodeURIComponent(currentJob)}/`);
            setStatus(`Opening ${currentJob}…`);
        }
    };
    const openArtifacts = async () => {
        if (!currentJob || !selectedBuild) {
            setStatus("No build selected");
            return;
        }
        setStatus("Loading artifacts…");
        try {
            const { artifacts: list } = await client.getArtifacts(currentJob, selectedBuild.number);
            setArtifacts(list);
            setArtifactSel(0);
            setOverlay("artifacts");
        }
        catch (e) {
            setStatus(chalk.red(`Artifact error: ${e.message}`));
        }
    };
    const downloadArtifact = async () => {
        const art = artifacts[artifactSel];
        if (!art || !currentJob || !selectedBuild)
            return;
        setStatus(`Downloading ${art.fileName}…`);
        try {
            const buf = await client.downloadArtifact(currentJob, selectedBuild.number, art.relativePath);
            const out = resolve(process.cwd(), art.fileName);
            writeFileSync(out, buf);
            setStatus(chalk.green(`Saved ${art.fileName}`));
        }
        catch (e) {
            setStatus(chalk.red(`Download error: ${e.message}`));
        }
    };
    const clearFilters = () => {
        setBuildQuery("");
        setJobQuery("");
        setLogSearchApplied("");
        setLogMatches([]);
        setLogMatchIdx(-1);
        setResultFilterIdx(0);
        setFoldersOnly(false);
        setStatus("Filters cleared");
    };
    // ---- input dispatch ------------------------------------------------------
    const commitMode = () => {
        if (mode === "jobSearch")
            setJobQuery(draft);
        else if (mode === "buildFilter" || mode === "buildSearch")
            setBuildQuery(draft);
        else if (mode === "logSearch") {
            setLogSearchApplied(draft);
            const m = findMatchingLines(logLines, draft);
            setLogMatches(m);
            setLogMatchIdx(m.length ? 0 : -1);
            if (m.length)
                setLogScroll(clamp(m[0], 0, maxLogScroll));
            setStatus(m.length
                ? chalk.green(`${m.length} matches — n/N to navigate`)
                : chalk.yellow("No matches"));
        }
        else if (mode === "jobLimit") {
            const n = parseInt(draft, 10);
            if (Number.isFinite(n) && n >= 0) {
                jobLimitRef.current = n;
                setStatus(`Job limit: ${n === 0 ? "UNLIMITED" : n}`);
                void loadJobs();
            }
            else
                setStatus("Invalid job limit");
        }
        setMode(null);
        setDraft("");
    };
    const cancelMode = () => {
        setMode(null);
        setDraft("");
        setStatus("Cancelled");
    };
    useInput((input, key) => {
        // ---- overlays ----
        if (overlay === "help") {
            if (input === "?" || key.escape || input === "q")
                setOverlay(null);
            return;
        }
        if (overlay === "artifacts") {
            if (key.escape || input === "a" || input === "q")
                setOverlay(null);
            else if (key.upArrow || input === "k")
                setArtifactSel((s) => clamp(s - 1, 0, Math.max(0, artifacts.length - 1)));
            else if (key.downArrow || input === "j")
                setArtifactSel((s) => clamp(s + 1, 0, Math.max(0, artifacts.length - 1)));
            else if (key.return)
                void downloadArtifact();
            return;
        }
        // ---- text entry modes ----
        if (mode) {
            if (key.escape)
                cancelMode();
            else if (key.return)
                commitMode();
            else if (key.backspace || key.delete)
                setDraft((d) => d.slice(0, -1));
            else if (input && input.length === 1 && /[\w.:_\-/ ]/.test(input))
                setDraft((d) => d + input);
            return;
        }
        // ---- global keys ----
        if (input === "q" || (key.ctrl && input === "c")) {
            abortRef.current?.abort();
            exit();
            return;
        }
        if (input === "r") {
            void loadJobs();
            setTick((t) => t + 1);
            setStatus("Refreshing…");
            return;
        }
        if (input === "f") {
            setFollow((v) => !v);
            return;
        }
        if (input === "S") {
            setSortAsc((v) => !v);
            return;
        }
        if (input === "t") {
            setAutoRefresh((v) => !v);
            setStatus(`Auto-refresh ${!autoRefresh ? `${AUTO_REFRESH_MS / 1000}s` : "OFF"}`);
            return;
        }
        if (input === "a") {
            void openArtifacts();
            return;
        }
        if (input === "L") {
            setMode("jobLimit");
            setDraft("");
            return;
        }
        if (input === "F") {
            setResultFilterIdx((i) => (i + 1) % RESULT_FILTERS.length);
            return;
        }
        if (input === "o" && !singleJobMode) {
            setFoldersOnly((v) => !v);
            return;
        }
        if (input === "b") {
            setMode("buildFilter");
            setDraft("");
            return;
        }
        if (input === "B") {
            setMode("buildSearch");
            setDraft("");
            return;
        }
        if (input === "c") {
            clearFilters();
            return;
        }
        if (input === "?") {
            setOverlay("help");
            return;
        }
        if (input === "/") {
            setMode(focus === "logs" ? "logSearch" : "jobSearch");
            setDraft("");
            return;
        }
        if (input === "w") {
            if (focus === "logs")
                return; // wrap toggle handled below; here 'w' = web
            openWeb();
            return;
        }
        // ---- pane navigation ----
        const panes = singleJobMode
            ? ["builds", "logs"]
            : ["jobs", "builds", "logs"];
        if (key.leftArrow) {
            setFocus((f) => panes[clamp(panes.indexOf(f) - 1, 0, panes.length - 1)]);
            return;
        }
        if (key.rightArrow) {
            setFocus((f) => panes[clamp(panes.indexOf(f) + 1, 0, panes.length - 1)]);
            return;
        }
        if (input === "1" && !singleJobMode)
            return setFocus("jobs");
        if (input === "2")
            return setFocus("builds");
        if (input === "3")
            return setFocus("logs");
        // ---- focus-specific ----
        if (focus === "logs") {
            if (input === "g")
                return setLogScroll(0);
            if (input === "G")
                return setLogScroll(maxLogScroll);
            if (input === "e")
                return jumpToLevel("ERROR");
            if (input === "W")
                return jumpToLevel("WARN");
            if (input === "i")
                return jumpToLevel("INFO");
            if (input === "l")
                return setShowLineNumbers((v) => !v);
            if (input === "m")
                return toggleBookmark();
            if (input === "M")
                return nextBookmark();
            if (input === "n")
                return gotoMatch(1);
            if (input === "N")
                return gotoMatch(-1);
            if (key.upArrow || input === "k")
                return scrollLog(-1);
            if (key.downArrow || input === "j")
                return scrollLog(1);
            if (key.pageUp)
                return scrollLog(-logRows);
            if (key.pageDown)
                return scrollLog(logRows);
            return;
        }
        if (focus === "jobs") {
            if (key.upArrow || input === "k")
                return setJobSel((s) => clamp(s - 1, 0, Math.max(0, filteredJobs.length - 1)));
            if (key.downArrow || input === "j")
                return setJobSel((s) => clamp(s + 1, 0, Math.max(0, filteredJobs.length - 1)));
            return;
        }
        if (focus === "builds") {
            if (key.upArrow || input === "k")
                return setBuildSel((s) => clamp(s - 1, 0, Math.max(0, filteredBuilds.length - 1)));
            if (key.downArrow || input === "j")
                return setBuildSel((s) => clamp(s + 1, 0, Math.max(0, filteredBuilds.length - 1)));
            return;
        }
    });
    // ---- render helpers ------------------------------------------------------
    const visibleLog = logLines.slice(logScroll, logScroll + logRows).map((l) => renderLogLine(l, {
        showLineNumbers,
        bookmarked: bookmarks.includes(l.number - 1),
        searchQuery: logSearchApplied || null,
    }));
    const jobItems = filteredJobs.map((j) => {
        const name = j.fullName || j.name || "";
        return j.error ? chalk.red(`${name} — ERROR`) : name;
    });
    const buildItems = filteredBuilds.map(colorizeBuild);
    const statusLine = (() => {
        if (mode) {
            const labels = {
                jobSearch: "Job search",
                buildFilter: "Build filter",
                buildSearch: "Build search",
                logSearch: "Log search",
                jobLimit: "Job limit (0=∞)",
            };
            return `${chalk.bold.magenta(labels[mode])}: ${draft}${chalk.inverse(" ")}  ${chalk.gray("(Enter apply · Esc cancel)")}`;
        }
        const rf = RESULT_FILTERS[resultFilterIdx];
        const parts = [
            chalk.bold.green(`[${focus.toUpperCase()}]`),
            status,
            chalk.gray("·"),
            `f:${follow ? chalk.green("ON") : "off"}`,
            `F:${rf}`,
            `sort:${sortAsc ? "ASC" : "DESC"}`,
            autoRefresh ? chalk.cyan("auto") : "",
            chalk.gray("? help · q quit"),
        ].filter(Boolean);
        return parts.join("  ");
    })();
    // ---- overlays ------------------------------------------------------------
    if (overlay === "help") {
        return (_jsxs(Box, { width: cols, height: rows, flexDirection: "column", padding: 1, children: [_jsx(Text, { color: "cyan", bold: true, children: "Jenkins TUI \u2014 Help" }), _jsx(Text, { children: " " }), _jsxs(Text, { children: [chalk.bold("Navigation"), " \u2190/\u2192 or 1/2/3 switch panes \u00B7 \u2191/\u2193 or j/k move \u00B7 q quit \u00B7 r refresh"] }), _jsxs(Text, { children: [chalk.bold("Builds"), " f follow \u00B7 S sort \u00B7 F result filter \u00B7 t auto-refresh \u00B7 a artifacts \u00B7 w open in web"] }), _jsxs(Text, { children: [chalk.bold("Search"), " / search (jobs or logs) \u00B7 b build filter \u00B7 B build search \u00B7 o folders-only \u00B7 c clear \u00B7 L job limit"] }), _jsxs(Text, { children: [chalk.bold("Logs"), " g/G top/bottom \u00B7 l line numbers \u00B7 m/M bookmark \u00B7 e/W/i jump error/warn/info \u00B7 n/N next/prev match"] }), _jsx(Text, { children: " " }), _jsxs(Text, { color: "gray", children: ["Legend: ", chalk.yellow("RUNNING"), " ", chalk.green("SUCCESS"), " ", chalk.red("FAILURE"), " ", chalk.magenta("UNSTABLE"), " ", chalk.cyan("ABORTED")] }), _jsx(Text, { children: " " }), _jsx(Text, { color: "gray", children: "Press ? or Esc to close" })] }));
    }
    if (overlay === "artifacts") {
        return (_jsxs(Box, { width: cols, height: rows, flexDirection: "column", padding: 1, children: [_jsxs(Text, { color: "blue", bold: true, children: ["Artifacts \u2014 build #", selectedBuild?.number, " (", artifacts.length, ")"] }), _jsx(Text, { children: " " }), artifacts.length === 0 ? (_jsx(Text, { color: "gray", children: "No artifacts" })) : (artifacts.slice(0, rows - 5).map((a, i) => (_jsx(Text, { wrap: "truncate", children: i === artifactSel
                        ? chalk.inverse(` ${a.relativePath} `)
                        : `  ${a.relativePath}` }, a.relativePath)))), _jsx(Text, { children: " " }), _jsx(Text, { color: "gray", children: "\u2191/\u2193 move \u00B7 Enter download \u00B7 a/Esc close" })] }));
    }
    // ---- main layout ---------------------------------------------------------
    const meta = selectedBuild ? (_jsx(_Fragment, { children: _jsxs(Text, { wrap: "truncate", children: [_jsxs(Text, { bold: true, children: ["#", selectedBuild.number] }), "  ", _jsx(Text, { color: selectedBuild.building
                        ? "yellow"
                        : selectedBuild.result === "SUCCESS"
                            ? "green"
                            : selectedBuild.result === "FAILURE"
                                ? "red"
                                : "cyan", children: buildState(selectedBuild) }), "  ", _jsx(Text, { color: "cyan", children: fmtDuration(selectedBuild) }), "  ", _jsx(Text, { color: "gray", children: selectedBuild.timestamp
                        ? new Date(selectedBuild.timestamp).toLocaleString()
                        : "" })] }) })) : (_jsx(Text, { color: "gray", children: "Select a build" }));
    return (_jsxs(Box, { width: cols, height: rows, flexDirection: "column", children: [_jsxs(Box, { height: bodyHeight, flexDirection: "row", children: [!singleJobMode && (_jsx(Panel, { title: "Jobs", color: "cyan", focused: focus === "jobs", width: jobsWidth, height: bodyHeight, children: _jsx(ScrollList, { items: jobItems, selected: jobSel, rows: listRows, emptyText: "Loading jobs\u2026" }) })), _jsx(Panel, { title: `Builds (# State Dur Age)`, color: "yellow", focused: focus === "builds", width: buildsWidth, height: bodyHeight, children: _jsx(ScrollList, { items: buildItems, selected: buildSel, rows: listRows, emptyText: "Select a job" }) }), _jsxs(Box, { flexDirection: "column", flexGrow: 1, height: bodyHeight, children: [_jsxs(Box, { height: metadataHeight, borderStyle: "round", borderColor: "cyan", flexDirection: "column", overflow: "hidden", children: [_jsx(Text, { color: "cyan", bold: true, children: "Build Info" }), meta] }), _jsx(Panel, { title: "Logs", color: "magenta", focused: focus === "logs", flexGrow: 1, children: logLines.length === 0 ? (_jsx(Text, { color: "gray", children: "No logs \u2014 select a build" })) : (_jsx(LogView, { lines: visibleLog })) })] })] }), _jsx(StatusBar, { content: statusLine, width: cols })] }));
};
