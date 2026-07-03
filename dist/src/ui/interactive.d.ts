import type { JenkinsClient } from "../jenkins-client.js";
export interface RunInteractiveOpts {
    jobSearchLimit?: number;
    buildsLimit?: number;
    forceBasicColor?: boolean;
    preselectJob?: string | null;
    noTerminfo?: boolean;
    jobsFilter?: string[] | null;
}
export declare function runInteractive(client: JenkinsClient, opts?: RunInteractiveOpts): Promise<void>;
