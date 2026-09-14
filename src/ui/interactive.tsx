import { useState } from "react"
import { render, useApp } from "ink"
import { useAppKeys } from "@kud/ink-ui"
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
// <JenkinsBody> — the same component cockpit mounts. This shell owns the
// full-screen takeover and the app keys: `q` quits from anywhere except a
// text mode, and esc is the body's while one of its own layers is up (it
// reports them through onFocus) — at the root there is nothing to go back to.
const Root = (props: Omit<JenkinsBodyProps, "onExit" | "onFocus">) => {
  const { exit } = useApp()
  const [focus, setFocus] = useState({ layer: false, typing: false })
  useAppKeys({
    isActive: !focus.typing,
    onQuit: exit,
    onBack: () => focus.layer,
  })
  return <JenkinsBody {...props} onExit={exit} onFocus={setFocus} />
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
