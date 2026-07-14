import { render, useApp } from "ink"
import type { JenkinsClient } from "@kud/jenkins"
import { JenkinsBody, type JenkinsBodyProps } from "@kud/jenkins-ink"

export interface RunInteractiveOpts {
  jobSearchLimit?: number
  buildsLimit?: number
  forceBasicColor?: boolean
  preselectJob?: string | null
  noTerminfo?: boolean
  jobsFilter?: string[] | null
}

// Alternate screen buffer: take over the whole terminal like vim/less, and hand
// the user's scrollback back untouched on exit.
const ENTER_ALT = "\x1b[?1049h\x1b[H"
const LEAVE_ALT = "\x1b[?1049l"

// The interactive grid now lives in @kud/jenkins-ink as the embeddable
// <JenkinsBody> — the same component cockpit mounts. This shell owns only the
// full-screen takeover and wires the body's onExit to Ink's app exit.
const Root = (props: Omit<JenkinsBodyProps, "onExit">) => {
  const { exit } = useApp()
  return <JenkinsBody {...props} onExit={exit} />
}

export async function runInteractive(
  client: JenkinsClient,
  opts: RunInteractiveOpts = {},
): Promise<void> {
  const jobsFilter = opts.jobsFilter ?? null
  const singleJobMode = !!(jobsFilter && jobsFilter.length === 1)

  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    process.stdout.write(LEAVE_ALT)
  }

  process.stdout.write(ENTER_ALT)
  process.once("exit", restore)

  const instance = render(
    <Root
      client={client}
      jobSearchLimit={opts.jobSearchLimit ?? 0}
      buildsLimit={opts.buildsLimit ?? 15}
      preselectJob={
        opts.preselectJob ?? (singleJobMode ? jobsFilter![0] : null)
      }
      jobsFilter={jobsFilter}
      singleJobMode={singleJobMode}
    />,
    { exitOnCtrlC: false },
  )

  try {
    await instance.waitUntilExit()
  } finally {
    restore()
    process.removeListener("exit", restore)
  }
}
