export interface JenkinsCrumb {
  crumb: string
  crumbRequestField: string
}
export interface JenkinsBuildRef {
  number: number
  url?: string
}
export interface JenkinsJob {
  name?: string
  fullName?: string
  url?: string
  color?: string
  jobs?: JenkinsJob[]
  lastBuild?: { number: number }
  builds?: Array<JenkinsBuildRef>
  artifacts?: JenkinsArtifact[]
  error?: string
}
export interface JenkinsArtifact {
  fileName: string
  relativePath: string
  size?: number
}
export interface JenkinsBuild {
  number: number
  building?: boolean
  result?: string
  artifacts?: JenkinsArtifact[]
  [k: string]: any
}
export interface JenkinsParameterDefinition {
  name: string
  type?: string
  description?: string
  defaultValue?: unknown
  choices?: string[]
}
export interface JenkinsCommit {
  id?: string
  author?: string
  msg?: string
  date?: string
}
export interface JenkinsBuildChanges {
  number: number
  causes: string[]
  culprits: string[]
  commits: JenkinsCommit[]
}
export interface ProgressiveLogOptions {
  signal?: AbortSignal
}
export type RequestAs = "buffer" | undefined
export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  as?: RequestAs
  body?: any
}
