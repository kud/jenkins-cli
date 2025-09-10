import { JenkinsClient } from '../jenkins-client.js';
interface RunInteractiveOpts {
    jobSearchLimit?: number;
    buildsLimit?: number;
    forceBasicColor?: boolean;
    preselectJob?: string | null;
    noTerminfo?: boolean;
    jobsFilter?: string[] | null;
}
export declare function runInteractive(client: JenkinsClient, { jobSearchLimit, buildsLimit, forceBasicColor, preselectJob, noTerminfo, jobsFilter }: RunInteractiveOpts): Promise<void>;
export {};
