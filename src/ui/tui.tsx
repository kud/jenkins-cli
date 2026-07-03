import type { JenkinsClient } from "../jenkins-client.js"
import { runInteractive } from "./interactive.js"

// `jenkins ui <job>` is the single-job view — a thin alias over the interactive
// explorer with the jobs panel collapsed. One implementation, two entry points.
export async function runTUI(
  client: JenkinsClient,
  { job, limit = 10 }: { job: string; limit?: number },
): Promise<void> {
  await runInteractive(client, {
    jobsFilter: [job],
    preselectJob: job,
    buildsLimit: limit,
  })
}
