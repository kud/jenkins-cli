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
