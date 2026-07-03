import type { JenkinsClient } from "../jenkins-client.js";
export interface AppProps {
    client: JenkinsClient;
    jobSearchLimit: number;
    buildsLimit: number;
    preselectJob: string | null;
    jobsFilter: string[] | null;
    singleJobMode: boolean;
}
export declare const App: ({ client, jobSearchLimit, buildsLimit, preselectJob, jobsFilter, singleJobMode, }: AppProps) => import("react").JSX.Element;
