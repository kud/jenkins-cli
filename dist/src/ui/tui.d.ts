import type { JenkinsClient } from "../jenkins-client.js";
export declare function runTUI(client: JenkinsClient, { job, limit }: {
    job: string;
    limit?: number;
}): Promise<void>;
