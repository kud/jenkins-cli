export declare const normalizeUrl: (u: any) => any;
export declare const ensureScheme: (u: any) => any;
export declare const parseBuildSpecifier: (input: any) => {
    type: string;
    baseUrl?: undefined;
    job?: undefined;
    buildNumber?: undefined;
    href?: undefined;
} | {
    type: string;
    baseUrl: string;
    job: string;
    buildNumber: string;
    href?: undefined;
} | {
    type: string;
    baseUrl: string;
    job: string;
    buildNumber?: undefined;
    href?: undefined;
} | {
    type: string;
    href: any;
    baseUrl?: undefined;
    job?: undefined;
    buildNumber?: undefined;
} | {
    type: string;
    job: any;
    baseUrl?: undefined;
    buildNumber?: undefined;
    href?: undefined;
};
