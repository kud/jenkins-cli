import { JenkinsJob, JenkinsBuild, JenkinsArtifact } from './types.js';
export declare class JenkinsClient {
    baseUrl: string;
    user: string;
    token: string;
    authHeader: string;
    timeout: number;
    retries: number;
    retryDelay: number;
    constructor(baseUrl: string, user: string, token: string, opts?: {
        timeout?: number;
        retries?: number;
        retryDelay?: number;
    });
    private _fetchWithTimeout;
    private _shouldRetry;
    private _request;
    private _getCrumb;
    getJob(job: string): Promise<JenkinsJob>;
    getBuild(job: string, buildNumber?: number): Promise<JenkinsBuild>;
    getConsoleText(job: string, buildNumber?: number): Promise<string>;
    streamConsole(job: string, buildNumber: number | undefined, onChunk: (chunk: string) => void, intervalMs?: number, opts?: {
        signal?: AbortSignal;
    }): Promise<void>;
    triggerBuild(job: string): Promise<{
        queued: true;
        location: string | null;
    }>;
    triggerBuildWithParameters(job: string, params?: Record<string, string>): Promise<{
        queued: true;
        location: string | null;
    }>;
    stopBuild(job: string, buildNumber: number): Promise<{
        stopped: true;
    }>;
    getQueue(): Promise<any>;
    cancelQueueItem(id: number | string): Promise<{
        cancelled: true;
    }>;
    getTestReport(job: string, buildNumber: number): Promise<any>;
    getPipelineStages(job: string, buildNumber: number): Promise<any>;
    listBuilds(job: string, limit?: number): Promise<JenkinsBuild[]>;
    getArtifacts(job: string, buildNumber?: number): Promise<{
        build: JenkinsBuild;
        artifacts: JenkinsArtifact[];
    }>;
    downloadArtifact(job: string, buildNumber: number, relativePath: string): Promise<Buffer>;
    getSpecificJobs(jobNames: string[]): Promise<JenkinsJob[]>;
    searchJobs(query: string, limit?: number): Promise<JenkinsJob[]>;
    searchJobsIncremental(query: string, opts?: {
        limit?: number;
        onBatch?: (jobs: JenkinsJob[], stats: {
            processed: number;
            queued: number;
            total: number;
        }) => void;
        concurrency?: number;
    }): Promise<JenkinsJob[]>;
}
