import type { JenkinsParameterDefinition } from "@kud/jenkins"

export interface TriggerPlanClient {
  getJobParameters(job: string): Promise<JenkinsParameterDefinition[]>
  triggerBuild(job: string): Promise<unknown>
  triggerBuildWithParameters(
    job: string,
    params: Record<string, string>,
  ): Promise<unknown>
}

export type TriggerPlan =
  | { kind: "build" }
  | { kind: "buildWithParameters"; params: Record<string, string> }
  | { kind: "refuse"; message: string }

const describeDefault = (def: JenkinsParameterDefinition): string =>
  def.defaultValue === undefined || def.defaultValue === null
    ? "no default"
    : String(def.defaultValue)

const shortType = (def: JenkinsParameterDefinition): string => {
  const t = def.type || "?"
  return t.endsWith("ParameterDefinition")
    ? t.slice(0, -"ParameterDefinition".length)
    : t
}

export const missingParameterReport = (
  defs: JenkinsParameterDefinition[],
  missing: JenkinsParameterDefinition[],
): string => {
  const width = Math.max(
    ...missing.map((d) => `--param ${d.name}=VALUE`.length),
  )
  const lines = missing.map((d) => {
    const cmd = `--param ${d.name}=VALUE`.padEnd(width)
    return `  ${cmd}  ${shortType(d)}  (default: ${describeDefault(d)})`
  })
  return [
    "This job has parameters and not all of them were supplied.",
    ...lines,
    "Pass every parameter on the command line as --param KEY=VALUE,",
    "or use --defaults to let Jenkins fill the rest from its own defaults.",
    "Valid parameters: " + defs.map((d) => d.name).join(", "),
  ].join("\n")
}

export const planTrigger = (
  defs: JenkinsParameterDefinition[],
  passedParams: Record<string, string>,
  { useDefaults }: { useDefaults: boolean },
): TriggerPlan => {
  if (!defs.length) {
    const extra = Object.keys(passedParams)
    if (extra.length) {
      return {
        kind: "refuse",
        message:
          `This job has no build parameters, so --param ${extra.join(" --param ")} ` +
          "would be ignored. Trigger it without --param instead.",
      }
    }
    return { kind: "build" }
  }

  const unknown = Object.keys(passedParams).filter(
    (k) => !defs.some((d) => d.name === k),
  )
  if (unknown.length) {
    return {
      kind: "refuse",
      message:
        `Unknown parameter${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. ` +
        "Valid parameters: " +
        defs.map((d) => d.name).join(", ") +
        ".",
    }
  }

  const missing = defs.filter((d) => !(d.name in passedParams))
  if (missing.length && !useDefaults) {
    return {
      kind: "refuse",
      message: missingParameterReport(defs, missing),
    }
  }

  return { kind: "buildWithParameters", params: passedParams }
}

export const parseParams = (pairs: string[]): Record<string, string> => {
  const params: Record<string, string> = {}
  for (const kv of pairs) {
    const idx = kv.indexOf("=")
    if (idx === -1) {
      throw new Error(
        `Param must be key=value: ${kv} (use --param KEY=VALUE, repeatable)`,
      )
    }
    params[kv.slice(0, idx)] = kv.slice(idx + 1)
  }
  return params
}

export const triggerJob = async (
  client: TriggerPlanClient,
  job: string,
  passedParams: Record<string, string>,
  opts: { defaults?: boolean } = {},
): Promise<unknown> => {
  const defs = await client.getJobParameters(job)
  const plan = planTrigger(defs, passedParams, { useDefaults: !!opts.defaults })
  if (plan.kind === "refuse") throw new Error(plan.message)
  if (plan.kind === "build") return client.triggerBuild(job)
  return client.triggerBuildWithParameters(job, plan.params)
}
