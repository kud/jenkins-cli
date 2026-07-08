#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Command } from "commander"
import {
  loadConfig,
  saveConfig,
  resolveConfig,
  addServer,
  useServer,
  removeServer,
  listServers,
  CONFIG_FILE,
} from "../src/config.js"
import { JenkinsClient } from "../src/jenkins-client.js"
import {
  formatStatus,
  formatBuildList,
  formatError,
  formatLogsChunk,
  formatJobList,
  formatJobTree,
  formatPipelineGraph,
} from "../src/format.js"
import {
  normalizeUrl,
  ensureScheme,
  parseBuildSpecifier,
} from "../src/url-utils.js"
import { withSpinner, createSpinner } from "../src/spinner.js"

// Colour is on by default when stdout is an interactive terminal, and off when
// piped, in JSON mode, when NO_COLOR is set, or via --no-color — so scripts and
// `--json` always get clean, uncoloured output. --pretty forces it on.
const useColor = (): boolean => {
  const o = program.opts()
  if (o.json) return false
  if (o.pretty) return true
  if (o.color === false || process.env.NO_COLOR) return false
  return !!process.stdout.isTTY
}

// Single source of truth for the version: read package.json at runtime rather
// than hardcoding a string that silently drifts on every release bump.
const resolveVersion = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    try {
      return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version
    } catch {
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  return "0.0.0"
}

const program = new Command()
program
  .name("jenkins")
  .description(
    "Lightweight Jenkins CLI (status, logs, trigger, list, artifacts, open, search, multi-server)",
  )
  .version(resolveVersion())
  .option("--url <url>", "Jenkins base URL")
  .option("--user <user>", "Jenkins username")
  .option("--token <token>", "Jenkins API token")
  .option("--json", "Raw JSON output", false)
  .option("--pretty", "Force colorised output (on by default in a TTY)", false)
  .option("--no-color", "Disable coloured output")
  .option("--server <name>", "Select configured server alias")
  .option(
    "--timeout <ms>",
    "Request timeout in milliseconds",
    process.env.JENKINS_TIMEOUT || "15000",
  )
  .option(
    "--retries <n>",
    "Retry count for failed requests",
    process.env.JENKINS_RETRIES || "0",
  )
  .option(
    "--debug-config",
    "Print raw & resolved configuration for troubleshooting",
    false,
  )
  .option("-i, --interactive", "Launch interactive multi-job explorer")
  .option("--basic-colors", "Force basic (no truecolor) colors in TUIs")
  .option(
    "--no-terminfo",
    "Disable terminfo/tput features (avoids Setulc warnings)",
  )
  .option("--project <job>", "Preselect job in interactive explorer")
  .option(
    "--jobs <jobs>",
    "Filter/specify jobs (comma-separated). Single job hides Jobs panel.",
  )

// Enhanced guidance for missing required positional arguments (non-interactive usage)
program.showHelpAfterError()
program.configureOutput({
  writeErr: (str) => {
    if (str && str.toLowerCase().includes("missing required argument")) {
      console.error(str.trim())
      console.error(
        "\nExamples:\n  jenkins status my-job\n  jenkins logs my-job -f\n  jenkins console my-job 123\n  jenkins list my-job\n\nTip: Provide the job name (or full build URL). See `jenkins --help` for more.",
      )
    } else {
      console.error(str)
    }
  },
})

const getClient = async () => {
  const globalOpts = program.opts()
  if (globalOpts.debugConfig)
    console.error("--- debug-config program.opts() ---", globalOpts)
  const fileConfig = loadConfig()
  if (globalOpts.debugConfig)
    console.error("--- debug-config fileConfig ---", fileConfig)
  const merged = resolveConfig({
    url: globalOpts.url,
    user: globalOpts.user,
    token: globalOpts.token,
    server: globalOpts.server,
  })
  if (globalOpts.debugConfig) {
    try {
      const fs = await import("fs")
      let raw = ""
      try {
        raw = fs.readFileSync(CONFIG_FILE, "utf8")
      } catch (_) {
        raw = "(missing)"
      }
      console.error("--- debug-config raw file ---")
      console.error(raw)
      console.error("--- debug-config resolved ---")
      console.error(merged)
      console.error("----------------------------")
    } catch (e) {
      console.error("debug-config error", e.message)
    }
  }
  if (!merged.url) {
    if (globalOpts.debugConfig) {
      console.error("DEBUG merged config missing url", merged)
    }
    console.error(
      "Missing Jenkins URL. Configure via config set or --url (or set JENKINS_URL)",
    )
    process.exit(1)
  }
  if (!merged.user || !merged.token) {
    console.error(
      "Missing credentials. Provide --user/--token or config set (or set JENKINS_USER/JENKINS_TOKEN)",
    )
    process.exit(1)
  }
  const timeout = parseInt(globalOpts.timeout, 10)
  const retries = parseInt(globalOpts.retries, 10)
  return new JenkinsClient(merged.url, merged.user, merged.token, {
    timeout: isNaN(timeout) ? undefined : timeout,
    retries: isNaN(retries) ? undefined : retries,
  })
}

program
  .command("config")
  .description("Manage stored configuration & servers")
  .argument(
    "[action]",
    "set | show | add-server | use | remove-server | list-servers",
  )
  .argument("[name]", "Server alias (for server operations)")
  .option("--url <url>")
  .option("--user <user>")
  .option("--token <token>")
  .option("--show", "Show current config")
  .action((action, name, options) => {
    try {
      const opts = options // Commander v14 passes options object directly
      if (opts.show || action === "show") {
        console.log(loadConfig())
        return
      }
      if (action === "set") {
        // Commander may place duplicated options at root or subcommand; support both.
        const root = program.opts()
        let url = opts.url || root.url
        let user = opts.user || root.user
        let token = opts.token || root.token
        if (!url && !user && !token) {
          console.error(
            "config set requires at least one of --url --user --token",
          )
          process.exit(1)
        }
        const ensureSchemeLocal = (u) => ensureScheme(u)
        const update: { url?: string; user?: string; token?: string } = {}
        if (url) update.url = ensureSchemeLocal(normalizeUrl(url))
        if (user) update.user = user
        if (token) update.token = token
        saveConfig(update)
        console.log(`Config updated: ${Object.keys(update).join(", ")}`)
        return
      }
      if (action === "add-server") {
        const { url, user, token } = opts
        if (!name || !url || !user || !token) {
          console.error("config add-server <name> --url --user --token")
          process.exit(1)
        }
        addServer(name, { url: normalizeUrl(url), user, token })
        console.log(`Server '${name}' added.`)
        return
      }
      if (action === "use") {
        if (!name) {
          console.error("config use <name>")
          process.exit(1)
        }
        useServer(name)
        console.log(`Current server set to '${name}'.`)
        return
      }
      if (action === "remove-server") {
        if (!name) {
          console.error("config remove-server <name>")
          process.exit(1)
        }
        removeServer(name)
        console.log(`Server '${name}' removed.`)
        return
      }
      if (action === "list-servers") {
        const servers = listServers()
        console.log(servers)
        return
      }
      console.log(
        "Usage: config set | show | add-server | use | remove-server | list-servers",
      )
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("console <jobOrUrl> [buildNumber]")
  .description("Show plain console output (alias of logs)")
  .action(async (jobOrUrl, buildNumber) => {
    try {
      const spec = parseBuildSpecifier(jobOrUrl)
      const job = spec.job
      const num = buildNumber || spec.buildNumber
      const client = await getClient()
      const text = await client.getConsoleText(job, num)
      process.stdout.write(text)
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("status <jobOrUrl> [buildNumber]")
  .description("Show build status by job or full build URL")
  .action(async (jobOrUrl, buildNumber) => {
    try {
      const spec = parseBuildSpecifier(jobOrUrl)
      let job = spec.job
      let num = buildNumber || spec.buildNumber
      const client = await getClient()
      // If full build URL provided with different base, warn (not auto-switching server yet)
      if (
        (spec.type === "build-url" || spec.type === "job-url") &&
        spec.baseUrl &&
        client.baseUrl.replace(/\/$/, "") !== spec.baseUrl
      ) {
        console.error(
          "Warning: build URL base differs from configured Jenkins URL; using configured URL for API calls.",
        )
      }
      const jsonFlag = program.opts().json
      const build = await withSpinner("Fetching status…", () =>
        client.getBuild(job, num),
      )
      if (jsonFlag) {
        console.log(JSON.stringify(build, null, 2))
      } else {
        console.log(formatStatus(build, { pretty: useColor() }))
      }
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("logs <jobOrUrl> [buildNumber]")
  .description("Fetch console logs (optionally follow) or via build URL")
  .option("-f, --follow", "Stream logs until completion")
  .option("--json", "Output JSON object { text } (disabled with --follow)")
  .action(async (jobOrUrl, buildNumber, cmd) => {
    const follow = cmd.follow
    try {
      const spec = parseBuildSpecifier(jobOrUrl)
      let job = spec.job
      let num = buildNumber || spec.buildNumber
      const client = await getClient()
      if (
        (spec.type === "build-url" || spec.type === "job-url") &&
        spec.baseUrl &&
        client.baseUrl.replace(/\/$/, "") !== spec.baseUrl
      ) {
        console.error(
          "Warning: build URL base differs from configured Jenkins URL; using configured URL.",
        )
      }
      if (follow && cmd.json) {
        console.error("--json not supported with --follow")
        process.exit(1)
      }
      if (!follow) {
        const text = await client.getConsoleText(job, num)
        if (cmd.json) {
          console.log(
            JSON.stringify(
              { job, build: num ? parseInt(num, 10) : undefined, text },
              null,
              2,
            ),
          )
        } else {
          process.stdout.write(text)
        }
      } else {
        await client.streamConsole(job, num, (chunk) => {
          process.stdout.write(formatLogsChunk(chunk))
        })
      }
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("trigger <jobOrUrl>")
  .description(
    "Trigger a new build by job or job URL (use build --param for parameters)",
  )
  .action(async (jobOrUrl) => {
    try {
      const spec = parseBuildSpecifier(jobOrUrl)
      if (spec.type === "build-url") {
        console.error(
          "Cannot trigger using a specific build URL; supply job or job URL.",
        )
        process.exit(1)
      }
      const client = await getClient()
      const res = await client.triggerBuild(spec.job)
      console.log(res)
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("build <job>")
  .description("Trigger a build, optionally with parameters (repeat --param)")
  .option(
    "--param <k=v>",
    "Parameter (repeatable)",
    (v, p) => {
      p.push(v)
      return p
    },
    [],
  )
  .action(async (job, cmd) => {
    try {
      const client = await getClient()
      const params = {}
      for (const kv of cmd.param) {
        const idx = kv.indexOf("=")
        if (idx === -1) {
          console.error("Param must be key=value: " + kv)
          process.exit(1)
        }
        const k = kv.slice(0, idx)
        const v = kv.slice(idx + 1)
        params[k] = v
      }
      const res = Object.keys(params).length
        ? await client.triggerBuildWithParameters(job, params)
        : await client.triggerBuild(job)
      console.log(res)
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("stop <job> <buildNumber>")
  .description("Stop/abort a running build")
  .action(async (job, buildNumber) => {
    try {
      const client = await getClient()
      const res = await client.stopBuild(job, buildNumber)
      console.log(res)
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("queue")
  .description("List queue items")
  .action(async () => {
    try {
      const client = await getClient()
      const q = await client.getQueue()
      const jsonFlag = program.opts().json
      if (jsonFlag) console.log(JSON.stringify(q, null, 2))
      else
        console.log(
          (q.items || [])
            .map(
              (i) =>
                `${i.id}\t${i.task?.name || ""}\tblocked=${i.blocked} buildable=${i.buildable}`,
            )
            .join("\n"),
        )
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("queue-cancel <id>")
  .description("Cancel a queue item by id")
  .action(async (id) => {
    try {
      const client = await getClient()
      const res = await client.cancelQueueItem(id)
      console.log(res)
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("test-report <job> <buildNumber>")
  .description("Fetch JUnit test report summary for a build")
  .action(async (job, buildNumber) => {
    try {
      const client = await getClient()
      const rep = await client.getTestReport(job, buildNumber)
      const jsonFlag = program.opts().json
      if (jsonFlag) console.log(JSON.stringify(rep, null, 2))
      else {
        const total = rep.totalCount
        const fail = rep.failCount
        const skip = rep.skipCount
        console.log(`# Tests: ${total}  Failed: ${fail}  Skipped: ${skip}`)
        if (rep.suites) {
          rep.suites
            .slice(0, 5)
            .forEach((s) =>
              console.log(`- ${s.name} ${s.cases?.length || 0} cases`),
            )
          if (rep.suites.length > 5)
            console.log(`... (${rep.suites.length - 5} more suites)`)
        }
      }
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("stages <job> [buildNumber]")
  .description(
    "Fetch pipeline stages (workflow-api plugin required); omit buildNumber (or pass 'latest') for the most recent build",
  )
  .option("-g, --graph", "Render stages as a vertical pipeline flow")
  .option(
    "-w, --watch",
    "Live-refresh the pipeline graph until the build finishes (implies --graph)",
  )
  .action(async (job, buildNumber, cmd) => {
    try {
      const client = await getClient()
      // Omitted or the literal "latest" => let the client resolve lastBuild.
      const ref =
        !buildNumber || buildNumber === "latest" ? undefined : buildNumber
      const jsonFlag = program.opts().json

      // Live watch: passive auto-refreshing graph. Needs a TTY to redraw in
      // place; when piped or in --json it falls through to a single render.
      if (cmd.watch && !jsonFlag && process.stdout.isTTY) {
        const { watchStages } = await import("../src/stages-watch.js")
        await watchStages(() => client.getPipelineStages(job, ref), {
          color: useColor(),
          label: `${job}${ref ? ` #${ref}` : ""}`,
        })
        return
      }

      const data = await withSpinner("Fetching stages…", () =>
        client.getPipelineStages(job, ref),
      )
      if (jsonFlag) {
        console.log(JSON.stringify(data, null, 2))
      } else if (cmd.graph || cmd.watch) {
        // Label from the resolved build: wfapi echoes its name/id, so "latest"
        // still prints the concrete build (e.g. #1360), not the word "latest".
        const build =
          data?.name ||
          (data?.id != null ? `#${data.id}` : ref ? `#${ref}` : "latest")
        console.log(
          formatPipelineGraph(data, {
            color: useColor(),
            width: process.stdout.columns || 80,
            label: `${job} ${build}`,
          }),
        )
      } else if (data.stages) {
        data.stages.forEach((s) =>
          console.log(
            `${s.id}\t${s.name}\t${s.status}\t${Math.round((s.durationMillis || 0) / 1000)}s`,
          ),
        )
      } else console.log("No stages")
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("params <job>")
  .description(
    "List a job's build parameter definitions (name, type, default, choices)",
  )
  .action(async (job) => {
    try {
      const client = await getClient()
      const defs = await client.getJobParameters(job)
      if (program.opts().json) {
        console.log(JSON.stringify(defs, null, 2))
      } else if (!defs.length) {
        console.log("No parameters (this job takes no build parameters).")
      } else {
        defs.forEach((d) => {
          const choices = d.choices?.length ? ` [${d.choices.join("|")}]` : ""
          const def =
            d.defaultValue !== undefined && d.defaultValue !== null
              ? ` (default: ${d.defaultValue})`
              : ""
          const desc = d.description ? `  - ${d.description}` : ""
          console.log(`${d.name}\t${d.type || "?"}${choices}${def}${desc}`)
        })
      }
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("changes <job> [buildNumber]")
  .description("Show what triggered a build and which commits it contains")
  .action(async (job, buildNumber) => {
    try {
      const client = await getClient()
      const info = await client.getBuildChanges(
        job,
        buildNumber ? parseInt(buildNumber, 10) : undefined,
      )
      if (program.opts().json) {
        console.log(JSON.stringify(info, null, 2))
        return
      }
      console.log(`# Build #${info.number}`)
      if (info.causes.length) console.log(`Cause: ${info.causes.join("; ")}`)
      if (info.culprits.length)
        console.log(`Culprits: ${info.culprits.join(", ")}`)
      if (!info.commits.length) {
        console.log("No SCM changes recorded for this build.")
      } else {
        console.log(`Changes (${info.commits.length}):`)
        info.commits.forEach((c) =>
          console.log(
            `  ${(c.id || "").slice(0, 9).padEnd(9)}  ${c.author || "?"}  ${(c.msg || "").split("\n")[0]}`,
          ),
        )
      }
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("list [jobOrUrl]")
  .description(
    "List top-level jobs (no argument; --all to recurse into folders), or recent builds for a job (by name or URL)",
  )
  .option("-l, --limit <n>", "Limit results")
  .option(
    "-a, --all",
    "Recurse into folders and list every job (concurrent crawl)",
  )
  .option("--flat", "With --all, force a flat list instead of a tree")
  .action(async (jobOrUrl, cmd) => {
    try {
      const client = await getClient()
      const jsonFlag = program.opts().json
      // No target => list jobs. Default is top-level only (one request); --all
      // walks the whole tree. With a target => builds for that job (default
      // 10), preserving the original single-job behaviour.
      if (!jobOrUrl) {
        const limit = cmd.limit ? parseInt(cmd.limit, 10) : 0
        let jobs
        if (cmd.all) {
          const spinner = createSpinner("Crawling jobs…")
          try {
            jobs = await client.searchJobsIncremental("", {
              limit,
              onBatch: (_j, s) =>
                spinner.setText(
                  `Crawling jobs… ${s.total} found (${s.queued} folders queued)`,
                ),
            })
          } finally {
            spinner.stop()
          }
        } else {
          jobs = await withSpinner("Fetching jobs…", () => client.listJobs())
        }
        const capped = limit ? jobs.slice(0, limit) : jobs
        if (jsonFlag) {
          console.log(JSON.stringify(capped, null, 2))
          return
        }
        const color = useColor()
        // Tree only for the recursive view in a real terminal; a pipe or --flat
        // gets full-path lines so `list --all | grep mobile` still matches.
        const asTree = cmd.all && !cmd.flat && !!process.stdout.isTTY
        console.log(
          asTree
            ? formatJobTree(capped, { color })
            : formatJobList(capped, { color }),
        )
        return
      }
      const spec = parseBuildSpecifier(jobOrUrl)
      const limit = cmd.limit ? parseInt(cmd.limit, 10) : 10
      const builds = await withSpinner("Fetching builds…", () =>
        client.listBuilds(spec.job, limit),
      )
      if (jsonFlag) {
        console.log(JSON.stringify(builds, null, 2))
      } else {
        console.log(formatBuildList(builds, { pretty: useColor() }))
      }
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("artifacts <jobOrUrl> [buildNumber]")
  .description("List or download artifacts for a build (job name or build URL)")
  .option("-o, --output <dir>", "Download all artifacts to directory")
  .option(
    "-p, --pattern <glob>",
    "Filter artifacts by substring (simple match)",
  )
  .action(async (jobOrUrl, buildNumber, cmd) => {
    try {
      const spec = parseBuildSpecifier(jobOrUrl)
      const job = spec.job
      const num = buildNumber || spec.buildNumber
      const client = await getClient()
      const { artifacts, build } = await client.getArtifacts(job, num)
      let list = artifacts
      if (cmd.pattern) {
        const pat = cmd.pattern.toLowerCase()
        list = list.filter(
          (a) =>
            a.fileName.toLowerCase().includes(pat) ||
            a.relativePath.toLowerCase().includes(pat),
        )
      }
      if (!cmd.output) {
        console.log(
          list
            .map((a) => `${a.fileName}\t${a.relativePath}\t${a.size || ""}`)
            .join("\n"),
        )
        return
      }
      const fs = await import("fs")
      const path = await import("path")
      fs.mkdirSync(cmd.output, { recursive: true })
      for (const a of list) {
        const buf = await client.downloadArtifact(
          job,
          build.number,
          a.relativePath,
        )
        const outFile = path.join(cmd.output, a.fileName)
        fs.writeFileSync(outFile, buf)
        console.log(`Saved ${outFile}`)
      }
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("open <jobOrUrl> [buildNumber]")
  .description("Open job or build in default browser (name or URL)")
  .action(async (jobOrUrl, buildNumber) => {
    try {
      const spec = parseBuildSpecifier(jobOrUrl)
      const client = await getClient()
      const base = client.baseUrl.replace(/\/$/, "")
      const num = buildNumber || spec.buildNumber
      let url
      if (num) {
        url = `${base}/job/${encodeURIComponent(spec.job)}/${num}/`
      } else {
        url = `${base}/job/${encodeURIComponent(spec.job)}/`
      }
      const { exec } = await import("child_process")
      const opener =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open"
      exec(`${opener} "${url}"`)
      console.log(url)
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("interactive [job]")
  .description(
    "Interactive explorer (jobs, builds, logs). Pass a job for a single-job view.",
  )
  .option(
    "-j, --jobs-limit <n>",
    "Set manual job cap (default unlimited; 0 = unlimited)",
    "0",
  )
  .option("-b, --builds-limit <n>", "Max builds per job", "15")
  .action(async (job, cmd) => {
    try {
      const client = await getClient()
      const { runInteractive } = await import("../src/ui/interactive.js")
      const root = program.opts()
      const jobsLimitVal = parseInt(cmd.jobsLimit, 10)
      const jobSearchLimit = isNaN(jobsLimitVal) ? 0 : jobsLimitVal // 0 => unlimited default
      // A positional job gives the collapsed single-job view (what `ui` did);
      // otherwise fall back to the root --jobs filter.
      const rootJobs = root.jobs
        ? root.jobs
            .split(",")
            .map((j) => j.trim())
            .filter(Boolean)
        : null
      const jobsFilter = job ? [job] : rootJobs
      await runInteractive(client, {
        jobSearchLimit,
        buildsLimit: parseInt(cmd.buildsLimit, 10) || 15,
        forceBasicColor: !!root.basicColors,
        preselectJob: job || root.project || null,
        noTerminfo: !!root.noTerminfo,
        jobsFilter,
      })
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

program
  .command("search <text>")
  .description("Search jobs by substring")
  .option("-l, --limit <n>", "Limit results", "50")
  .action(async (text, cmd) => {
    try {
      const client = await getClient()
      const limit = parseInt(cmd.limit, 10) || 50
      const jobs = await withSpinner(`Searching for "${text}"…`, () =>
        client.searchJobs(text, limit),
      )
      if (program.opts().json) {
        console.log(JSON.stringify(jobs, null, 2))
      } else {
        console.log(formatJobList(jobs, { color: useColor() }))
      }
    } catch (e) {
      formatError(e)
      process.exit(1)
    }
  })

// Root action (fires only when no subcommand matched). Launch the interactive
// explorer when asked explicitly (-i), or as the default for a bare `jenkins`
// when stdout is a TTY and a server is fully configured. Otherwise fall back to
// help — this keeps pipes, CI, and first-run (unconfigured) users on the safe,
// side-effect-free path.
program.action(async () => {
  const opts = program.opts()
  const resolved = resolveConfig({
    url: opts.url,
    user: opts.user,
    token: opts.token,
    server: opts.server,
  })
  const configured = !!(resolved.url && resolved.user && resolved.token)
  const wantInteractive =
    opts.interactive || (!!process.stdout.isTTY && configured)
  if (!wantInteractive) {
    program.outputHelp()
    return
  }
  try {
    const client = await getClient()
    const { runInteractive } = await import("../src/ui/interactive.js")
    const pre = opts.project || null
    const jobsFilter = opts.jobs
      ? opts.jobs
          .split(",")
          .map((j) => j.trim())
          .filter(Boolean)
      : null
    await runInteractive(client, {
      forceBasicColor: !!opts.basicColors,
      preselectJob: pre,
      noTerminfo: !!opts.noTerminfo,
      jobsFilter,
    })
  } catch (e) {
    formatError(e)
    process.exit(1)
  }
})

program.parseAsync(process.argv)
