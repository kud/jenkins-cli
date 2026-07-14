import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Box, Text, useApp, useInput, useStdout } from "ink"
import chalk from "chalk"
import { exec } from "node:child_process"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type {
  JenkinsClient,
  JenkinsArtifact,
  JenkinsBuild,
  JenkinsJob,
} from "@kud/jenkins"
import {
  appendToLog,
  emptyLogAppendState,
  findMatchingLines,
  firstLineOfLevel,
  processLog,
  renderLogLine,
  toVisualLines,
  type LogAppendState,
  type LogLine,
} from "./log-format.js"
import { Overlay, Panel, StatusBar } from "./components.js"
import {
  BuildInfo,
  BuildList,
  JobList,
  LogView,
  StageTree,
} from "@kud/jenkins-ink"

export interface AppProps {
  client: JenkinsClient
  jobSearchLimit: number
  buildsLimit: number
  preselectJob: string | null
  jobsFilter: string[] | null
  singleJobMode: boolean
}

type Focus = "jobs" | "builds" | "logs"
type Mode =
  | null
  | "jobSearch"
  | "buildFilter"
  | "buildSearch"
  | "logSearch"
  | "jobLimit"
type OverlayKind =
  | null
  | "help"
  | "artifacts"
  | "actions"
  | "statusFilter"
  | "stages"
type StageLevel = "stages" | "steps" | "log"

interface ActionItem {
  key: "abort" | "trigger" | "web" | "artifacts" | "stages"
  label: string
  hint: string
}

// Statuses offered in the multi-select filter modal. Any build state outside
// this list (e.g. NOT_BUILT / UNKNOWN) is always shown.
const BUILD_STATUSES = [
  "SUCCESS",
  "FAILURE",
  "UNSTABLE",
  "ABORTED",
  "RUNNING",
] as const
const AUTO_REFRESH_MS = 10000

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v))

const buildState = (b: JenkinsBuild) =>
  b.building ? "RUNNING" : b.result || "UNKNOWN"

const useTermSize = () => {
  const { stdout } = useStdout()
  const [size, setSize] = useState({
    cols: stdout.columns || 80,
    rows: stdout.rows || 24,
  })
  useEffect(() => {
    const onResize = () =>
      setSize({ cols: stdout.columns || 80, rows: stdout.rows || 24 })
    stdout.on("resize", onResize)
    return () => {
      stdout.off("resize", onResize)
    }
  }, [stdout])
  return size
}

const openInBrowser = (url: string) => {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open"
  exec(`${opener} "${url}"`)
}

export const App = ({
  client,
  jobSearchLimit,
  buildsLimit,
  preselectJob,
  jobsFilter,
  singleJobMode,
}: AppProps) => {
  const { exit } = useApp()
  const { cols, rows } = useTermSize()

  // ---- layout maths (fullscreen) ------------------------------------------
  const bodyHeight = Math.max(3, rows - 3) // minus status bar
  const jobsWidth = singleJobMode ? 0 : Math.max(16, Math.floor(cols * 0.2))
  const buildsWidth = singleJobMode
    ? Math.max(20, Math.floor(cols * 0.3))
    : Math.max(16, Math.floor(cols * 0.2))
  const metadataHeight = 4
  const rightWidth = Math.max(
    20,
    cols - (singleJobMode ? 0 : jobsWidth) - buildsWidth,
  )
  const logContentWidth = Math.max(10, rightWidth - 2) // inside the log panel border
  const logRows = Math.max(1, bodyHeight - metadataHeight - 3) // 2 border + 1 title
  const listRows = Math.max(1, bodyHeight - 3)
  const logRowsRef = useRef(logRows)
  logRowsRef.current = logRows
  // Where "the latest line" lives: top (0) when descending, bottom otherwise.
  const logDescendingRef = useRef(true)
  const scrollToLatest = (logicalLineCount: number) =>
    logDescendingRef.current
      ? 0
      : Math.max(0, logicalLineCount - logRowsRef.current)

  // ---- data state ----------------------------------------------------------
  const [jobs, setJobs] = useState<JenkinsJob[]>(
    singleJobMode && jobsFilter
      ? [{ name: jobsFilter[0], fullName: jobsFilter[0] }]
      : [],
  )
  const [jobSel, setJobSel] = useState(0)
  const [jobQuery, setJobQuery] = useState("")
  const [foldersOnly, setFoldersOnly] = useState(false)

  const [builds, setBuilds] = useState<JenkinsBuild[]>([])
  const [buildSel, setBuildSel] = useState(0)
  const [buildQuery, setBuildQuery] = useState("")
  // Multi-select status filter (all shown by default); builds always newest-first.
  const [statuses, setStatuses] = useState<Set<string>>(
    () => new Set(BUILD_STATUSES),
  )
  const [statusSel, setStatusSel] = useState(0)
  // Log order: descending = newest line at the top (default).
  const [logDescending, setLogDescending] = useState(true)
  logDescendingRef.current = logDescending

  const [logLines, setLogLines] = useState<LogLine[]>([])
  const [logScroll, setLogScroll] = useState(0)
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  // Wrap is ON by default: it pre-segments log lines to the pane width before
  // Ink renders, which avoids Ink's runtime truncate (unreliable with wide/emoji
  // chars in some terminals — lines would overflow and the terminal hard-wraps,
  // corrupting the layout). Press `w` in the logs pane to switch to truncate.
  const [wrap, setWrap] = useState(true)
  const [bookmarks, setBookmarks] = useState<number[]>([]) // line indices
  const [logSearchApplied, setLogSearchApplied] = useState("")
  const [logMatches, setLogMatches] = useState<number[]>([])
  const [logMatchIdx, setLogMatchIdx] = useState(-1)

  const [follow, setFollow] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [focus, setFocus] = useState<Focus>(singleJobMode ? "builds" : "jobs")
  const [mode, setMode] = useState<Mode>(null)
  const [draft, setDraft] = useState("") // live text for the active mode
  const [overlay, setOverlay] = useState<OverlayKind>(null)
  const [artifacts, setArtifacts] = useState<JenkinsArtifact[]>([])
  const [artifactSel, setArtifactSel] = useState(0)
  const [actionSel, setActionSel] = useState(0)
  // Stage drill-down overlay: one overlay, three levels (stages → steps → log).
  const [pipelineStages, setPipelineStages] = useState<any>(null)
  const [stageSel, setStageSel] = useState(0)
  const [stageLevel, setStageLevel] = useState<StageLevel>("stages")
  const [stageSteps, setStageSteps] = useState<any[]>([])
  const [stepSel, setStepSel] = useState(0)
  const [stepLog, setStepLog] = useState("")
  const [stepLogScroll, setStepLogScroll] = useState(0)
  const [status, setStatus] = useState("Initializing…")
  const [confirm, setConfirm] = useState<{
    action: "stop" | "trigger"
    n?: number
  } | null>(null)
  const [tick, setTick] = useState(0) // manual/auto refresh trigger

  const jobLimitRef = useRef(jobSearchLimit)
  const abortRef = useRef<AbortController | null>(null)
  const rawRef = useRef("")
  const preselectDone = useRef(false)

  // ---- derived: filtered lists --------------------------------------------
  const filteredJobs = useMemo(() => {
    let list = jobs
    if (jobQuery) {
      const q = jobQuery.toLowerCase()
      list = list.filter((j) =>
        (j.fullName || j.name || "").toLowerCase().includes(q),
      )
    }
    if (foldersOnly)
      list = list.filter((j) => (j.fullName || j.name || "").includes("/"))
    return list
  }, [jobs, jobQuery, foldersOnly])

  const filteredBuilds = useMemo(() => {
    // Always newest-first; filter by the selected status set (states outside the
    // known list are always shown so nothing silently disappears).
    const base = builds.slice().sort((a, b) => b.number - a.number)
    const byStatus = base.filter((b) => {
      const state = buildState(b)
      return (
        !BUILD_STATUSES.includes(state as (typeof BUILD_STATUSES)[number]) ||
        statuses.has(state)
      )
    })
    if (!buildQuery) return byStatus
    const q = buildQuery.toLowerCase()
    return byStatus.filter((b) =>
      `#${b.number} ${buildState(b)}`.toLowerCase().includes(q),
    )
  }, [builds, statuses, buildQuery])

  const currentJob =
    singleJobMode && jobsFilter
      ? jobsFilter[0]
      : (filteredJobs[jobSel]?.name ?? null)
  const currentJobObj = singleJobMode ? null : (filteredJobs[jobSel] ?? null)
  const selectedBuild = filteredBuilds[buildSel] ?? null
  const selectedBuildNumber = selectedBuild?.number ?? null

  // keep selections in range as filters shrink lists
  useEffect(() => {
    if (jobSel >= filteredJobs.length) setJobSel(0)
  }, [filteredJobs.length, jobSel])
  useEffect(() => {
    if (buildSel >= filteredBuilds.length) setBuildSel(0)
  }, [filteredBuilds.length, buildSel])

  // Visual log model: each logical line becomes one row (wrap off) or several
  // wrapped rows (wrap on). Windowing/scroll operates on visual rows, so
  // maxLogScroll and every jump stay correct regardless of wrap.
  //
  // Per-line render+wrap is cached by LogLine identity so live-follow only pays
  // for newly-appended lines (LogLine objects are stable once created), instead
  // of re-chalk-formatting and re-wrapping the whole buffer every tick. The
  // cache is invalidated wholesale when a display toggle changes (rare).
  const logGutter = showLineNumbers ? 7 : 0
  const visualCacheRef = useRef<{ key: string; map: Map<LogLine, string[]> }>({
    key: "",
    map: new Map(),
  })
  const visualLog = useMemo(() => {
    const key = `${wrap}|${logContentWidth}|${showLineNumbers}|${logSearchApplied}|${bookmarks.join(",")}`
    if (visualCacheRef.current.key !== key) {
      visualCacheRef.current = { key, map: new Map() }
    }
    const cache = visualCacheRef.current.map
    const out: string[] = []
    // Descending = newest line at the top: iterate lines in reverse, but keep
    // each line's own wrapped segments in reading order.
    const ordered = logDescending ? logLines.slice().reverse() : logLines
    for (const l of ordered) {
      let segs = cache.get(l)
      if (!segs) {
        const rendered = renderLogLine(l, {
          showLineNumbers,
          bookmarked: bookmarks.includes(l.number - 1),
          searchQuery: logSearchApplied || null,
        })
        segs = wrap
          ? toVisualLines([rendered], logContentWidth, logGutter)
          : [rendered]
        cache.set(l, segs)
      }
      for (const s of segs) out.push(s)
    }
    return out
  }, [
    logLines,
    showLineNumbers,
    bookmarks,
    logSearchApplied,
    wrap,
    logContentWidth,
    logGutter,
    logDescending,
  ])

  const maxLogScroll = Math.max(0, visualLog.length - logRows)
  useEffect(() => {
    setLogScroll((s) => clamp(s, 0, maxLogScroll))
  }, [maxLogScroll])

  // ---- load jobs -----------------------------------------------------------
  const loadJobs = useCallback(async () => {
    if (singleJobMode) return
    setStatus("Loading jobs…")
    try {
      if (jobsFilter && jobsFilter.length) {
        setJobs(await client.getSpecificJobs(jobsFilter))
      } else {
        await client.searchJobsIncremental("", {
          limit: jobLimitRef.current,
          onBatch: (list) => setJobs(list.slice()),
        })
      }
      setStatus("Jobs loaded")
    } catch (e) {
      setStatus(`Job load error: ${(e as Error).message}`)
    }
  }, [client, jobsFilter, singleJobMode])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  // preselect a job once jobs are present
  useEffect(() => {
    if (
      preselectDone.current ||
      !preselectJob ||
      singleJobMode ||
      !filteredJobs.length
    )
      return
    const idx = filteredJobs.findIndex((j) => j.name === preselectJob)
    if (idx >= 0) {
      setJobSel(idx)
      preselectDone.current = true
    }
  }, [filteredJobs, preselectJob, singleJobMode])

  // ---- load builds when the current job changes ---------------------------
  useEffect(() => {
    if (!currentJob) return
    if (currentJobObj?.error) {
      setBuilds([])
      setLogLines([])
      setStatus(chalk.red(`Job error: ${currentJobObj.error}`))
      return
    }
    let cancelled = false
    setStatus(`Loading builds for ${currentJob}…`)
    client
      .listBuilds(currentJob, buildsLimit)
      .then((bs) => {
        if (cancelled) return
        setBuilds(bs)
        setBuildSel(0)
        setStatus(
          bs.length
            ? chalk.green(`Builds loaded (${bs.length})`)
            : chalk.yellow(`No builds for ${currentJob}`),
        )
      })
      .catch((e) => {
        if (!cancelled) {
          setBuilds([])
          setStatus(chalk.red(`Build load error: ${e.message}`))
        }
      })
    return () => {
      cancelled = true
    }
  }, [client, currentJob, currentJobObj?.error, buildsLimit, tick])

  // ---- load / follow logs when the selected build changes -----------------
  useEffect(() => {
    if (!currentJob || selectedBuildNumber == null) {
      setLogLines([])
      return
    }
    const ac = new AbortController()
    abortRef.current?.abort()
    abortRef.current = ac
    rawRef.current = ""
    setLogLines([])
    setLogScroll(0)
    let cancelled = false
    const building = selectedBuild?.building === true

    const applyRaw = (toLatest: boolean) => {
      const lines = processLog(rawRef.current)
      setLogLines(lines)
      if (toLatest) setLogScroll(scrollToLatest(lines.length))
    }

    const runFollow = async () => {
      setStatus(chalk.cyan(`Following build #${selectedBuildNumber}…`))
      let appendState: LogAppendState = emptyLogAppendState()
      try {
        await client.streamConsole(
          currentJob,
          selectedBuildNumber,
          (chunk) => {
            rawRef.current += chunk // kept for the final reconcile + log search
            // Process only the new chunk, append its complete lines — O(chunk),
            // not O(whole buffer), so following a long build stays linear.
            const { lines, state } = appendToLog(chunk, appendState)
            appendState = state
            if (lines.length) {
              setLogLines((prev) => [...prev, ...lines])
              setLogScroll(scrollToLatest(appendState.nextNumber - 1))
            }
          },
          2000,
          { signal: ac.signal },
        )
        if (!ac.signal.aborted) {
          applyRaw(true) // final reconcile: flush the pending partial line & normalise
          setStatus(chalk.green(`Build #${selectedBuildNumber} complete`))
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          setStatus(chalk.red(`Follow error: ${(e as Error).message}`))
      }
    }

    ;(async () => {
      if (follow && building) {
        await runFollow()
        return
      }
      setStatus(`Fetching logs #${selectedBuildNumber}…`)
      try {
        const text = await client.getConsoleText(
          currentJob,
          selectedBuildNumber,
        )
        if (cancelled) return
        if (!text || !text.trim()) {
          if (building) {
            setFollow(true) // re-runs this effect in follow mode
            return
          }
          setLogLines([])
          setStatus(chalk.gray("No console output"))
          return
        }
        rawRef.current = text
        const lines = processLog(text)
        setLogLines(lines)
        setLogScroll(scrollToLatest(lines.length))
        const errors = lines.filter(
          (l) => l.level === "ERROR" || l.level === "FATAL",
        ).length
        const warns = lines.filter(
          (l) => l.level === "WARN" || l.level === "WARNING",
        ).length
        setStatus(
          chalk.green(`Logs loaded — ${lines.length} lines`) +
            (errors ? chalk.red(` ${errors} err`) : "") +
            (warns ? chalk.yellow(` ${warns} warn`) : ""),
        )
      } catch (e) {
        if (!cancelled) {
          setLogLines([])
          setStatus(chalk.red(`Log error: ${(e as Error).message}`))
        }
      }
    })()

    return () => {
      cancelled = true
      ac.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, currentJob, selectedBuildNumber, follow, tick])

  // ---- auto-refresh --------------------------------------------------------
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => setTick((t) => t + 1), AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [autoRefresh])

  // ---- log navigation helpers ---------------------------------------------
  const scrollLog = (delta: number) =>
    setLogScroll((s) => clamp(s + delta, 0, maxLogScroll))

  const jumpToLevel = (level: string) => {
    const idx = firstLineOfLevel(logLines, level, logScroll + 1)
    if (idx < 0) {
      setStatus(chalk.yellow(`No ${level} lines`))
      return
    }
    setLogScroll(clamp(idx, 0, maxLogScroll))
    setStatus(chalk.green(`Jumped to ${level} @ line ${idx + 1}`))
  }

  const toggleBookmark = () => {
    const line = logScroll // bookmark the top visible line
    setBookmarks((bm) =>
      bm.includes(line)
        ? bm.filter((x) => x !== line)
        : [...bm, line].sort((a, b) => a - b),
    )
    setStatus(chalk.green(`Bookmark toggled @ line ${line + 1}`))
  }

  const nextBookmark = () => {
    if (!bookmarks.length) {
      setStatus(chalk.yellow("No bookmarks — press m to add one"))
      return
    }
    const next = bookmarks.find((b) => b > logScroll) ?? bookmarks[0]
    setLogScroll(clamp(next, 0, maxLogScroll))
    setStatus(
      chalk.green(
        `Bookmark ${bookmarks.indexOf(next) + 1}/${bookmarks.length} @ line ${next + 1}`,
      ),
    )
  }

  const gotoMatch = (dir: 1 | -1) => {
    if (!logMatches.length) return
    const i = clamp(logMatchIdx + dir, 0, logMatches.length - 1)
    const wrapped =
      logMatchIdx + dir < 0
        ? logMatches.length - 1
        : logMatchIdx + dir >= logMatches.length
          ? 0
          : i
    setLogMatchIdx(wrapped)
    setLogScroll(clamp(logMatches[wrapped], 0, maxLogScroll))
    setStatus(chalk.green(`Match ${wrapped + 1}/${logMatches.length}`))
  }

  const openWeb = () => {
    if (!currentJob) {
      setStatus("No job selected")
      return
    }
    const base = client.baseUrl.replace(/\/$/, "")
    if (focus === "builds" && selectedBuild) {
      openInBrowser(
        `${base}/job/${encodeURIComponent(currentJob)}/${selectedBuild.number}/`,
      )
      setStatus(`Opening build #${selectedBuild.number}…`)
    } else {
      openInBrowser(`${base}/job/${encodeURIComponent(currentJob)}/`)
      setStatus(`Opening ${currentJob}…`)
    }
  }

  const openArtifacts = async () => {
    if (!currentJob || !selectedBuild) {
      setStatus("No build selected")
      return
    }
    setStatus("Loading artifacts…")
    try {
      const { artifacts: list } = await client.getArtifacts(
        currentJob,
        selectedBuild.number,
      )
      setArtifacts(list)
      setArtifactSel(0)
      setOverlay("artifacts")
    } catch (e) {
      setStatus(chalk.red(`Artifact error: ${(e as Error).message}`))
    }
  }

  // Stage drill-down loaders. Fetch on demand (on Enter), not on selection, so
  // arrowing through stages/steps doesn't hammer the API — mirrors openArtifacts.
  const openStages = async () => {
    if (!currentJob || selectedBuildNumber == null) {
      setStatus("No build selected")
      return
    }
    setStatus("Loading stages…")
    try {
      const data = await client.getPipelineStages(
        currentJob,
        selectedBuildNumber,
      )
      setPipelineStages(data)
      setStageSel(0)
      setStageLevel("stages")
      setOverlay("stages")
    } catch (e) {
      setStatus(chalk.red(`Stages error: ${(e as Error).message}`))
    }
  }

  const openSteps = async (stage: any) => {
    if (!currentJob || selectedBuildNumber == null || !stage?.id) return
    setStatus(`Loading steps for ${stage.name}…`)
    try {
      const data = await client.getStageSteps(
        currentJob,
        selectedBuildNumber,
        stage.id,
      )
      setStageSteps(data?.stageFlowNodes ?? [])
      setStepSel(0)
      setStageLevel("steps")
    } catch (e) {
      setStatus(chalk.red(`Steps error: ${(e as Error).message}`))
    }
  }

  const openStepLog = async (step: any) => {
    if (!currentJob || selectedBuildNumber == null || !step?.id) return
    setStatus(`Loading log for ${step.name}…`)
    try {
      const text = await client.getStepLog(
        currentJob,
        selectedBuildNumber,
        step.id,
      )
      setStepLog(text || "(no log for this step)")
      setStepLogScroll(0)
      setStageLevel("log")
    } catch (e) {
      setStatus(chalk.red(`Step log error: ${(e as Error).message}`))
    }
  }

  const downloadArtifact = async () => {
    const art = artifacts[artifactSel]
    if (!art || !currentJob || !selectedBuild) return
    setStatus(`Downloading ${art.fileName}…`)
    try {
      const buf = await client.downloadArtifact(
        currentJob,
        selectedBuild.number,
        art.relativePath,
      )
      const out = resolve(process.cwd(), art.fileName)
      writeFileSync(out, buf)
      setStatus(chalk.green(`Saved ${art.fileName}`))
    } catch (e) {
      setStatus(chalk.red(`Download error: ${(e as Error).message}`))
    }
  }

  const clearFilters = () => {
    setBuildQuery("")
    setJobQuery("")
    setLogSearchApplied("")
    setLogMatches([])
    setLogMatchIdx(-1)
    setStatuses(new Set(BUILD_STATUSES))
    setFoldersOnly(false)
    setStatus("Filters cleared")
  }

  // ---- input dispatch ------------------------------------------------------
  const commitMode = () => {
    if (mode === "jobSearch") setJobQuery(draft)
    else if (mode === "buildFilter" || mode === "buildSearch")
      setBuildQuery(draft)
    else if (mode === "logSearch") {
      setLogSearchApplied(draft)
      const m = findMatchingLines(logLines, draft)
      setLogMatches(m)
      setLogMatchIdx(m.length ? 0 : -1)
      if (m.length) setLogScroll(clamp(m[0], 0, maxLogScroll))
      setStatus(
        m.length
          ? chalk.green(`${m.length} matches — n/N to navigate`)
          : chalk.yellow("No matches"),
      )
    } else if (mode === "jobLimit") {
      const n = parseInt(draft, 10)
      if (Number.isFinite(n) && n >= 0) {
        jobLimitRef.current = n
        setStatus(`Job limit: ${n === 0 ? "UNLIMITED" : n}`)
        void loadJobs()
      } else setStatus("Invalid job limit")
    }
    setMode(null)
    setDraft("")
  }

  // Actions available from the Enter menu, contextual to the selected build.
  const actionItems: ActionItem[] = [
    ...(selectedBuild?.building
      ? [
          {
            key: "abort" as const,
            label: "Abort running build",
            hint: `stop #${selectedBuild.number}`,
          },
        ]
      : []),
    {
      key: "trigger",
      label: "Trigger new build",
      hint: `re-run ${currentJob ?? "job"}`,
    },
    {
      key: "web",
      label: "Open in browser",
      hint: selectedBuild ? `build #${selectedBuild.number}` : "job page",
    },
    ...(selectedBuild
      ? [
          {
            key: "stages" as const,
            label: "View pipeline stages",
            hint: `stages & step logs`,
          },
        ]
      : []),
    { key: "artifacts", label: "View artifacts", hint: "list & download" },
  ]

  const openActions = () => {
    if (!currentJob) {
      setStatus("No job selected")
      return
    }
    setActionSel(0)
    setOverlay("actions")
  }

  const runAction = (item: ActionItem) => {
    setOverlay(null)
    if (item.key === "abort" && selectedBuild)
      setConfirm({ action: "stop", n: selectedBuild.number })
    else if (item.key === "trigger") setConfirm({ action: "trigger" })
    else if (item.key === "web") openWeb()
    else if (item.key === "artifacts") void openArtifacts()
    else if (item.key === "stages") void openStages()
  }

  // Execute a gated build action (abort a running build / trigger a new run).
  // Jenkins exposes a single "abort" — stop/kill/cancel all resolve to stopBuild.
  const runConfirmed = async () => {
    const c = confirm
    setConfirm(null)
    if (!c || !currentJob) return
    if (c.action === "stop" && c.n != null) {
      setStatus(chalk.yellow(`Stopping #${c.n}…`))
      try {
        await client.stopBuild(currentJob, c.n)
        setStatus(chalk.green(`Aborted #${c.n}`))
        setTick((t) => t + 1)
      } catch (e) {
        setStatus(chalk.red(`Stop failed: ${(e as Error).message}`))
      }
    } else if (c.action === "trigger") {
      setStatus(chalk.yellow(`Triggering ${currentJob}…`))
      try {
        await client.triggerBuild(currentJob)
        setStatus(chalk.green("Build queued"))
        setTimeout(() => setTick((t) => t + 1), 1500) // give Jenkins a moment to register the build
      } catch (e) {
        setStatus(chalk.red(`Trigger failed: ${(e as Error).message}`))
      }
    }
  }

  const cancelMode = () => {
    setMode(null)
    setDraft("")
    setStatus("Cancelled")
  }

  useInput((input, key) => {
    // ---- overlays ----
    if (overlay === "help") {
      if (input === "?" || key.escape || input === "q") setOverlay(null)
      return
    }
    if (overlay === "artifacts") {
      if (key.escape || input === "a" || input === "q") setOverlay(null)
      else if (key.upArrow || input === "k")
        setArtifactSel((s) =>
          clamp(s - 1, 0, Math.max(0, artifacts.length - 1)),
        )
      else if (key.downArrow || input === "j")
        setArtifactSel((s) =>
          clamp(s + 1, 0, Math.max(0, artifacts.length - 1)),
        )
      else if (key.return) void downloadArtifact()
      return
    }
    if (overlay === "actions") {
      if (key.escape || input === "q") setOverlay(null)
      else if (key.upArrow || input === "k")
        setActionSel((s) =>
          clamp(s - 1, 0, Math.max(0, actionItems.length - 1)),
        )
      else if (key.downArrow || input === "j")
        setActionSel((s) =>
          clamp(s + 1, 0, Math.max(0, actionItems.length - 1)),
        )
      else if (key.return && actionItems[actionSel])
        runAction(actionItems[actionSel])
      return
    }
    if (overlay === "statusFilter") {
      if (key.escape || key.return || input === "q" || input === "F")
        setOverlay(null)
      else if (key.upArrow || input === "k")
        setStatusSel((s) => clamp(s - 1, 0, BUILD_STATUSES.length - 1))
      else if (key.downArrow || input === "j")
        setStatusSel((s) => clamp(s + 1, 0, BUILD_STATUSES.length - 1))
      else if (input === " ") {
        const st = BUILD_STATUSES[statusSel]
        setStatuses((prev) => {
          const next = new Set(prev)
          next.has(st) ? next.delete(st) : next.add(st)
          return next
        })
      } else if (input === "a") setStatuses(new Set(BUILD_STATUSES))
      else if (input === "n") setStatuses(new Set())
      return
    }
    if (overlay === "stages") {
      const stages = pipelineStages?.stages ?? []
      if (stageLevel === "stages") {
        if (key.escape || input === "q") setOverlay(null)
        else if (key.upArrow || input === "k")
          setStageSel((s) => clamp(s - 1, 0, Math.max(0, stages.length - 1)))
        else if (key.downArrow || input === "j")
          setStageSel((s) => clamp(s + 1, 0, Math.max(0, stages.length - 1)))
        else if (key.return && stages[stageSel])
          void openSteps(stages[stageSel])
      } else if (stageLevel === "steps") {
        if (key.escape) setStageLevel("stages")
        else if (input === "q") setOverlay(null)
        else if (key.upArrow || input === "k")
          setStepSel((s) => clamp(s - 1, 0, Math.max(0, stageSteps.length - 1)))
        else if (key.downArrow || input === "j")
          setStepSel((s) => clamp(s + 1, 0, Math.max(0, stageSteps.length - 1)))
        else if (key.return && stageSteps[stepSel])
          void openStepLog(stageSteps[stepSel])
      } else {
        // log level
        const maxScroll = Math.max(0, stepLog.split("\n").length - (rows - 6))
        if (key.escape) setStageLevel("steps")
        else if (input === "q") setOverlay(null)
        else if (key.upArrow || input === "k")
          setStepLogScroll((s) => clamp(s - 1, 0, maxScroll))
        else if (key.downArrow || input === "j")
          setStepLogScroll((s) => clamp(s + 1, 0, maxScroll))
        else if (key.pageUp)
          setStepLogScroll((s) => clamp(s - 10, 0, maxScroll))
        else if (key.pageDown)
          setStepLogScroll((s) => clamp(s + 10, 0, maxScroll))
      }
      return
    }

    // ---- confirmation gate (build actions) ----
    if (confirm) {
      if (input === "y" || input === "Y") void runConfirmed()
      else {
        setConfirm(null)
        setStatus("Cancelled")
      }
      return
    }

    // ---- text entry modes ----
    if (mode) {
      if (key.escape) cancelMode()
      else if (key.return) commitMode()
      else if (key.backspace || key.delete) setDraft((d) => d.slice(0, -1))
      else if (input && input.length === 1 && /[\w.:_\-/ ]/.test(input))
        setDraft((d) => d + input)
      return
    }

    // ---- build actions ----
    // Enter opens the contextual action menu (unless a pane needs Enter itself).
    if (key.return && focus !== "logs") {
      openActions()
      return
    }
    // Direct shortcuts (also available from the menu):
    if (input === "x") {
      if (selectedBuild?.building)
        setConfirm({ action: "stop", n: selectedBuild.number })
      else setStatus("Selected build is not running")
      return
    }
    if (input === "T") {
      if (currentJob) setConfirm({ action: "trigger" })
      else setStatus("No job selected")
      return
    }

    // ---- global keys ----
    if (input === "q" || (key.ctrl && input === "c")) {
      abortRef.current?.abort()
      exit()
      return
    }
    if (input === "r") {
      void loadJobs()
      setTick((t) => t + 1)
      setStatus("Refreshing…")
      return
    }
    if (input === "f") {
      setFollow((v) => !v)
      return
    }
    if (input === "S") {
      // Flip log order (newest-at-top ↔ oldest-at-top) and jump to the top.
      setLogDescending((v) => !v)
      setLogScroll(0)
      setStatus(
        `Log order: ${!logDescending ? "newest first" : "oldest first"}`,
      )
      return
    }
    if (input === "t") {
      setAutoRefresh((v) => !v)
      setStatus(
        `Auto-refresh ${!autoRefresh ? `${AUTO_REFRESH_MS / 1000}s` : "OFF"}`,
      )
      return
    }
    if (input === "a") {
      void openArtifacts()
      return
    }
    if (input === "p") {
      void openStages()
      return
    }
    if (input === "L") {
      setMode("jobLimit")
      setDraft("")
      return
    }
    if (input === "F") {
      setStatusSel(0)
      setOverlay("statusFilter")
      return
    }
    if (input === "o" && !singleJobMode) {
      setFoldersOnly((v) => !v)
      return
    }
    if (input === "b") {
      setMode("buildFilter")
      setDraft("")
      return
    }
    if (input === "B") {
      setMode("buildSearch")
      setDraft("")
      return
    }
    if (input === "c") {
      clearFilters()
      return
    }
    if (input === "?") {
      setOverlay("help")
      return
    }
    if (input === "/") {
      setMode(focus === "logs" ? "logSearch" : "jobSearch")
      setDraft("")
      return
    }
    if (input === "w") {
      if (focus === "logs") {
        setWrap((v) => !v)
        setStatus(`Word wrap ${!wrap ? "ON" : "OFF"}`)
      } else {
        openWeb()
      }
      return
    }

    // ---- pane navigation ----
    const panes: Focus[] = singleJobMode
      ? ["builds", "logs"]
      : ["jobs", "builds", "logs"]
    if (key.leftArrow) {
      setFocus((f) => panes[clamp(panes.indexOf(f) - 1, 0, panes.length - 1)])
      return
    }
    if (key.rightArrow) {
      setFocus((f) => panes[clamp(panes.indexOf(f) + 1, 0, panes.length - 1)])
      return
    }
    if (input === "1" && !singleJobMode) return setFocus("jobs")
    if (input === "2") return setFocus("builds")
    if (input === "3") return setFocus("logs")

    // ---- focus-specific ----
    if (focus === "logs") {
      if (input === "g") return setLogScroll(0)
      if (input === "G") return setLogScroll(maxLogScroll)
      if (input === "e") return jumpToLevel("ERROR")
      if (input === "W") return jumpToLevel("WARN")
      if (input === "i") return jumpToLevel("INFO")
      if (input === "l") return setShowLineNumbers((v) => !v)
      if (input === "m") return toggleBookmark()
      if (input === "M") return nextBookmark()
      if (input === "n") return gotoMatch(1)
      if (input === "N") return gotoMatch(-1)
      if (key.upArrow || input === "k") return scrollLog(-1)
      if (key.downArrow || input === "j") return scrollLog(1)
      if (key.pageUp) return scrollLog(-logRows)
      if (key.pageDown) return scrollLog(logRows)
      return
    }
    if (focus === "jobs") {
      if (key.upArrow || input === "k")
        return setJobSel((s) =>
          clamp(s - 1, 0, Math.max(0, filteredJobs.length - 1)),
        )
      if (key.downArrow || input === "j")
        return setJobSel((s) =>
          clamp(s + 1, 0, Math.max(0, filteredJobs.length - 1)),
        )
      return
    }
    if (focus === "builds") {
      if (key.upArrow || input === "k")
        return setBuildSel((s) =>
          clamp(s - 1, 0, Math.max(0, filteredBuilds.length - 1)),
        )
      if (key.downArrow || input === "j")
        return setBuildSel((s) =>
          clamp(s + 1, 0, Math.max(0, filteredBuilds.length - 1)),
        )
      return
    }
  })

  // ---- render helpers ------------------------------------------------------
  const visibleLog = visualLog.slice(logScroll, logScroll + logRows)

  // Footer: context on the left, live state chips + hints right-aligned.
  const footer = (() => {
    if (confirm) {
      const q =
        confirm.action === "stop"
          ? `Abort running build #${confirm.n}?`
          : `Trigger a new build of ${currentJob}?`
      return { left: chalk.bold.red(q), right: chalk.gray("y / N") }
    }
    if (mode) {
      const labels: Record<Exclude<Mode, null>, string> = {
        jobSearch: "Job search",
        buildFilter: "Build filter",
        buildSearch: "Build search",
        logSearch: "Log search",
        jobLimit: "Job limit (0=∞)",
      }
      return {
        left: `${chalk.bold.magenta(labels[mode])}: ${draft}${chalk.inverse(" ")}`,
        right: chalk.gray("Enter apply · Esc cancel"),
      }
    }
    const badge = chalk.bold.bgGreen.black(` ${focus.toUpperCase()} `)
    const left = `${badge}  ${status}`
    // State chips: dim label + value, so they read as *state*, not keys.
    const chip = (label: string, on: boolean, onText = "on", offText = "off") =>
      `${chalk.gray(label)} ${on ? chalk.green(onText) : chalk.dim(offText)}`
    const allStatuses = statuses.size === BUILD_STATUSES.length
    const statusVal =
      statuses.size === 0
        ? chalk.red("none")
        : allStatuses
          ? chalk.dim("all")
          : chalk.cyan(`${statuses.size}/${BUILD_STATUSES.length}`)
    const chips = [
      chip("follow", follow),
      chip("wrap", wrap),
      `${chalk.gray("status")} ${statusVal}`,
      `${chalk.gray("logs")} ${chalk.dim(logDescending ? "newest↑" : "oldest↑")}`,
      autoRefresh ? chalk.green("auto") : "",
    ]
      .filter(Boolean)
      .join(chalk.dim("  "))
    // Key hints: highlighted KEY + label, so it's obvious `?` reveals all keys.
    const hint = (key: string, label: string) =>
      `${chalk.bold.cyan(key)} ${chalk.gray(label)}`
    const hints = [
      hint("↵", "menu"),
      hint("p", "stages"),
      hint("r", "refresh"),
      hint("?", "keys"),
      hint("q", "quit"),
    ].join(chalk.dim(" · "))
    const right = `${chips}    ${hints}`
    return { left, right }
  })()

  // ---- overlays ------------------------------------------------------------
  if (overlay === "help") {
    // key = bright cyan, label = default; grouped so hotkeys are easy to scan.
    const k = (key: string, label: string) =>
      `${chalk.bold.cyan(key)} ${chalk.gray(label)}`
    const row = (...pairs: Array<[string, string]>) =>
      pairs.map(([key, label]) => k(key, label)).join(chalk.gray("   "))
    return (
      <Overlay
        title="Keyboard shortcuts"
        color="cyan"
        width={cols}
        height={rows}
      >
        <Text bold color="magenta">
          Panes & navigation
        </Text>
        <Text>
          {row(
            ["←/→", "cycle panes"],
            ["1/2/3", "jump pane"],
            ["↑/↓", "move"],
            ["r", "refresh"],
            ["q", "quit"],
          )}
        </Text>
        <Text> </Text>
        <Text bold color="magenta">
          Build actions
        </Text>
        <Text>
          {row(
            ["↵", "action menu"],
            ["x", "abort build"],
            ["T", "trigger build"],
            ["a", "artifacts"],
            ["p", "pipeline stages"],
            ["w", "open in web"],
          )}
        </Text>
        <Text> </Text>
        <Text bold color="magenta">
          Filter & search
        </Text>
        <Text>
          {row(
            ["/", "search"],
            ["b/B", "build filter"],
            ["F", "status filter"],
            ["o", "folders"],
            ["c", "clear"],
            ["L", "job limit"],
          )}
        </Text>
        <Text> </Text>
        <Text bold color="magenta">
          Logs
        </Text>
        <Text>
          {row(
            ["f", "follow"],
            ["w", "wrap"],
            ["l", "line #s"],
            ["g/G", "top/bottom"],
            ["m/M", "bookmark"],
          )}
        </Text>
        <Text>
          {row(
            ["e/W/i", "jump err/warn/info"],
            ["n/N", "next/prev match"],
            ["S", "log order (newest/oldest)"],
            ["t", "auto-refresh"],
          )}
        </Text>
        <Text> </Text>
        <Text color="gray">
          {chalk.yellow("RUNNING")} {chalk.green("SUCCESS")}{" "}
          {chalk.red("FAILURE")} {chalk.magenta("UNSTABLE")}{" "}
          {chalk.cyan("ABORTED")}
          {chalk.gray("      ? or Esc to close")}
        </Text>
      </Overlay>
    )
  }
  if (overlay === "artifacts") {
    return (
      <Box width={cols} height={rows} flexDirection="column" padding={1}>
        <Text color="blue" bold>
          Artifacts — build #{selectedBuild?.number} ({artifacts.length})
        </Text>
        <Text> </Text>
        {artifacts.length === 0 ? (
          <Text color="gray">No artifacts</Text>
        ) : (
          artifacts.slice(0, rows - 5).map((a, i) => (
            <Text key={a.relativePath} wrap="truncate">
              {i === artifactSel
                ? `${chalk.cyan("❯")} ${a.relativePath}`
                : `  ${a.relativePath}`}
            </Text>
          ))
        )}
        <Text> </Text>
        <Text color="gray">↑/↓ move · Enter download · a/Esc close</Text>
      </Box>
    )
  }
  if (overlay === "stages") {
    const stages = pipelineStages?.stages ?? []
    const stageName = stages[stageSel]?.name ?? ""
    const stepName = stageSteps[stepSel]?.name ?? ""
    const crumb =
      stageLevel === "stages"
        ? ""
        : stageLevel === "steps"
          ? ` · ${stageName}`
          : ` · ${stageName} › ${stepName}`
    const title = `Stages — ${currentJob ?? "job"} #${selectedBuild?.number ?? "?"}${crumb}`
    const innerRows = Math.max(1, rows - 6)
    const hint =
      stageLevel === "stages"
        ? "↑/↓ move · ↵ steps · q/Esc close"
        : stageLevel === "steps"
          ? "↑/↓ move · ↵ log · Esc back · q close"
          : "↑/↓ scroll · Esc back · q close"
    return (
      <Overlay title={title} color="green" width={cols} height={rows}>
        <StageTree
          level={stageLevel}
          stages={stages}
          steps={stageSteps}
          stepLog={stepLog
            .split("\n")
            .slice(stepLogScroll, stepLogScroll + innerRows)}
          selected={stageLevel === "steps" ? stepSel : stageSel}
          rows={innerRows}
        />
        <Text> </Text>
        <Text color="gray">{hint}</Text>
      </Overlay>
    )
  }
  if (overlay === "actions") {
    const title = `Actions — ${currentJob ?? "job"}${
      selectedBuild
        ? ` #${selectedBuild.number} · ${buildState(selectedBuild)}`
        : ""
    }`
    return (
      <Overlay title={title} color="magenta" width={cols} height={rows}>
        {actionItems.map((it, i) => (
          <Text key={it.key} wrap="truncate">
            {i === actionSel
              ? `${chalk.cyan("❯")} ${it.label}`
              : `  ${it.label}`}
            {chalk.gray(`  — ${it.hint}`)}
          </Text>
        ))}
        <Text> </Text>
        <Text color="gray">↑/↓ move · ↵ run · Esc close</Text>
      </Overlay>
    )
  }
  if (overlay === "statusFilter") {
    const paint = (s: string) =>
      s === "SUCCESS"
        ? chalk.green(s)
        : s === "FAILURE"
          ? chalk.red(s)
          : s === "UNSTABLE"
            ? chalk.magenta(s)
            : s === "ABORTED"
              ? chalk.cyan(s)
              : chalk.yellow(s)
    return (
      <Overlay
        title="Show build statuses"
        color="yellow"
        width={cols}
        height={rows}
      >
        {BUILD_STATUSES.map((s, i) => {
          const box = statuses.has(s) ? chalk.green("[x]") : chalk.gray("[ ]")
          const label = `${box} ${paint(s)}`
          return (
            <Text key={s} wrap="truncate">
              {i === statusSel ? `${chalk.cyan("❯")} ${label}` : `  ${label}`}
            </Text>
          )
        })}
        <Text> </Text>
        <Text color="gray">Space toggle · a all · n none · ↵/Esc close</Text>
      </Overlay>
    )
  }

  // ---- main layout ---------------------------------------------------------

  return (
    <Box width={cols} height={rows} flexDirection="column">
      <Box height={bodyHeight} flexDirection="row">
        {!singleJobMode && (
          <Panel
            title="Jobs"
            color="cyan"
            focused={focus === "jobs"}
            width={jobsWidth}
            height={bodyHeight}
          >
            <JobList
              jobs={filteredJobs}
              selected={jobSel}
              rows={listRows}
              emptyText="Loading jobs…"
            />
          </Panel>
        )}
        <Panel
          title={`Builds (# State Dur Age)`}
          color="yellow"
          focused={focus === "builds"}
          width={buildsWidth}
          height={bodyHeight}
        >
          <BuildList
            builds={filteredBuilds}
            selected={buildSel}
            rows={listRows}
            emptyText="Select a job"
          />
        </Panel>
        <Box flexDirection="column" width={rightWidth} height={bodyHeight}>
          <Box
            height={metadataHeight}
            width={rightWidth}
            borderStyle="round"
            borderColor="cyan"
            flexDirection="column"
            overflow="hidden"
          >
            <Text color="cyan" bold wrap="truncate">
              Build Info
            </Text>
            <BuildInfo build={selectedBuild} />
          </Box>
          <Panel
            title="Logs"
            color="magenta"
            focused={focus === "logs"}
            width={rightWidth}
            height={Math.max(3, bodyHeight - metadataHeight)}
          >
            {logLines.length === 0 ? (
              <Text color="gray">No logs — select a build</Text>
            ) : (
              <LogView lines={visibleLog} width={logContentWidth} />
            )}
          </Panel>
        </Box>
      </Box>
      <StatusBar left={footer.left} right={footer.right} width={cols} />
    </Box>
  )
}
