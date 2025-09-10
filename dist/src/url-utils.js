// URL utility helpers for Jenkins CLI
// Focus: normalization, ensuring scheme, parsing full build/job URLs.
export const normalizeUrl = (u) => {
    if (!u)
        return u;
    const m = u.match(/^(https?):(?!\/\/)(.*)$/i);
    if (m)
        return `${m[1]}://${m[2].replace(/^\/+/, '')}`; // add missing //
    return u;
};
export const ensureScheme = (u) => {
    if (!u)
        return u;
    if (!/^https?:\/\//i.test(u))
        return 'https://' + u.replace(/^\/+/, '');
    return u;
};
// parseBuildSpecifier handles inputs like:
// - job name only: returns { type:'job', job, buildNumber:null }
// - job + buildNumber: caller still supplies separate args (handled elsewhere)
// - full build URL: https://ci.example.com/job/my-job/123/ -> { type:'build-url', baseUrl, job:'my-job', buildNumber:'123' }
// - full job URL: https://ci.example.com/job/my-job/ -> { type:'job-url', baseUrl, job:'my-job' }
// Supports single-level jobs; nested folders could be added in future.
export const parseBuildSpecifier = (input) => {
    if (!input)
        return { type: 'empty' };
    try {
        const url = new URL(input);
        // Path like /job/<name>/<num>/ or /job/<name>/
        const parts = url.pathname.split('/').filter(Boolean);
        const jobIdx = parts.indexOf('job');
        if (jobIdx !== -1 && parts.length >= jobIdx + 2) {
            const job = decodeURIComponent(parts[jobIdx + 1]);
            const maybeNumber = parts[jobIdx + 2];
            if (maybeNumber && /^\d+$/.test(maybeNumber)) {
                return { type: 'build-url', baseUrl: `${url.protocol}//${url.host}`, job, buildNumber: maybeNumber };
            }
            return { type: 'job-url', baseUrl: `${url.protocol}//${url.host}`, job };
        }
        return { type: 'url-unknown', href: input };
    }
    catch (_) {
        // Not a URL
        return { type: 'job', job: input };
    }
};
