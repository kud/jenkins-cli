// A tiny stderr spinner for one-shot commands. Deliberately not Ink: this is
// fire-and-forget feedback that must NOT touch stdout (so `jenkins list | grep`
// stays clean) and must vanish when output isn't an interactive terminal
// (pipes, CI, dumb terminals). Ink is reserved for the persistent explorer.

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const FRAMES = SPINNER_FRAMES

const spinnerEnabled = (): boolean =>
  !!process.stderr.isTTY &&
  !process.env.CI &&
  process.env.TERM !== "dumb" &&
  process.env.JENKINS_CLI_PLAIN !== "1"

export interface Spinner {
  setText(text: string): void
  stop(): void
}

export const createSpinner = (text: string): Spinner => {
  const enabled = spinnerEnabled()
  let current = text
  let frame = 0
  let timer: ReturnType<typeof setInterval> | undefined

  if (enabled) {
    process.stderr.write("\x1b[?25l") // hide cursor
    timer = setInterval(() => {
      frame = (frame + 1) % FRAMES.length
      process.stderr.write(`\r\x1b[K${FRAMES[frame]} ${current}`)
    }, 80)
  }

  const stop = () => {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
    if (enabled) process.stderr.write("\r\x1b[K\x1b[?25h") // clear line, show cursor
  }

  return {
    setText: (t: string) => {
      current = t
    },
    stop,
  }
}

// Run an async task under a spinner, always clearing it afterwards — even on
// throw, so a failure never leaves a frozen spinner or a hidden cursor behind.
export const withSpinner = async <T>(
  text: string,
  fn: (spinner: Spinner) => Promise<T>,
): Promise<T> => {
  const spinner = createSpinner(text)
  try {
    return await fn(spinner)
  } finally {
    spinner.stop()
  }
}
