import { formatPipelineGraph } from "./format.js"
import { SPINNER_FRAMES } from "./spinner.js"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A build is still worth watching only while it's actively running; any terminal
// state (or an empty status, meaning nothing to follow) ends the loop.
const isRunning = (data: any): boolean => {
  const s = String(data?.status || "").toUpperCase()
  return s === "IN_PROGRESS" || s === "PAUSED"
}

// Live pipeline view: repaints the stage graph in place, animating a spinner on
// in-progress stages, until the build reaches a terminal state. This is the
// CLI-layer "live" mode — passive (no navigation), so it stays ANSI + stdout
// rather than mounting an interactive Ink surface. Redraw is cursor-up + clear;
// the graph is width-bounded so lines never wrap and the line count stays exact.
export const watchStages = async (
  fetchStages: () => Promise<any>,
  { color, label }: { color: boolean; label: string },
): Promise<any> => {
  const TICK_MS = 125
  const POLL_EVERY = 20 // re-fetch every 20 ticks (~2.5s); animate every tick

  const restore = () => process.stdout.write("\x1b[?25h")
  const onSigint = () => {
    restore()
    process.exit(130)
  }
  process.stdout.write("\x1b[?25l") // hide cursor
  process.on("SIGINT", onSigint)

  let prevLines = 0
  const draw = (data: any, frame: string) => {
    const out = formatPipelineGraph(data, {
      color,
      width: process.stdout.columns || 80,
      label,
      runningFrame: frame,
    })
    if (prevLines) process.stdout.write(`\x1b[${prevLines}A\x1b[0J`)
    process.stdout.write(out + "\n")
    prevLines = out.split("\n").length
  }

  try {
    let data = await fetchStages()
    let tick = 0
    while (true) {
      const running = isRunning(data)
      draw(data, running ? SPINNER_FRAMES[tick % SPINNER_FRAMES.length] : "")
      if (!running) break
      await sleep(TICK_MS)
      tick++
      if (tick % POLL_EVERY === 0) data = await fetchStages()
    }
    return data
  } finally {
    process.off("SIGINT", onSigint)
    restore()
  }
}
