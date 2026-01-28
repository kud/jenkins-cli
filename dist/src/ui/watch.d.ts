import { JenkinsClient } from '../jenkins-client.js';
interface WatchOptions {
    job: string;
    refreshInterval?: number;
    forceBasicColor?: boolean;
    noTerminfo?: boolean;
}
export declare function runWatch(client: JenkinsClient, { job, refreshInterval, forceBasicColor, noTerminfo }: WatchOptions): Promise<void>;
export {};
