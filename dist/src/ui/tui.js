import { runInteractive } from "./interactive.js";
// `jenkins ui <job>` is the single-job view — a thin alias over the interactive
// explorer with the jobs panel collapsed. One implementation, two entry points.
export async function runTUI(client, { job, limit = 10 }) {
    await runInteractive(client, {
        jobsFilter: [job],
        preselectJob: job,
        buildsLimit: limit,
    });
}
