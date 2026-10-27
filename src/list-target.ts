import { jobPath } from "@kud/jenkins"
import type { JenkinsBuild, JenkinsJob } from "@kud/jenkins"

// What `list <target>` can find: a folder or multibranch container holds child
// jobs, a leaf job holds builds. Either can be empty, which is an answer, not
// an error: a fresh job has no builds yet, a new folder no jobs.
export type ListTargetResult =
  | { kind: "job"; job: string; builds: JenkinsBuild[] }
  | { kind: "folder"; job: string; children: JenkinsJob[] }

// Structural so tests can pass a hand-written fake instead of a JenkinsClient.
export interface ListTargetClient {
  getJob(job: string): Promise<JenkinsJob>
  listBuilds(job: string, limit?: number): Promise<JenkinsBuild[]>
  tree<T = any>(path: string, tree?: string): Promise<T>
}

// Detect with one getJob: only a container carries a `jobs` array, so its
// presence (even empty) is what tells the two apart. Children at depth=1 lack
// lastBuild details, so a non-empty container takes one more request, a tree
// query scoped to the job's own path.
export const resolveListTarget = async (
  client: ListTargetClient,
  job: string,
  { limit }: { limit?: number } = {},
): Promise<ListTargetResult> => {
  const capped = limit !== undefined && Number.isFinite(limit)
  const info = await client.getJob(job)
  if (Array.isArray(info.jobs)) {
    if (!info.jobs.length) return { kind: "folder", job, children: [] }
    const range = capped ? `{0,${limit}}` : ""
    const fetched = await client.tree<any>(
      `${jobPath(job)}/api/json`,
      `_class,jobs[name,fullName,url,color,lastBuild[number,result]]${range}`,
    )
    const children = (Array.isArray(fetched?.jobs) ? fetched.jobs : []).slice(
      0,
      capped ? limit : undefined,
    )
    return { kind: "folder", job, children }
  }
  const builds = await client.listBuilds(job, capped ? limit : 10)
  return { kind: "job", job, builds }
}
