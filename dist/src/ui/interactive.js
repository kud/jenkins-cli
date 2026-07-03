import { jsx as _jsx } from "react/jsx-runtime";
import { render } from "ink";
import { App } from "./app.js";
// Alternate screen buffer: take over the whole terminal like vim/less, and hand
// the user's scrollback back untouched on exit.
const ENTER_ALT = "\x1b[?1049h\x1b[H";
const LEAVE_ALT = "\x1b[?1049l";
export async function runInteractive(client, opts = {}) {
    const jobsFilter = opts.jobsFilter ?? null;
    const singleJobMode = !!(jobsFilter && jobsFilter.length === 1);
    let restored = false;
    const restore = () => {
        if (restored)
            return;
        restored = true;
        process.stdout.write(LEAVE_ALT);
    };
    process.stdout.write(ENTER_ALT);
    process.once("exit", restore);
    const instance = render(_jsx(App, { client: client, jobSearchLimit: opts.jobSearchLimit ?? 0, buildsLimit: opts.buildsLimit ?? 15, preselectJob: opts.preselectJob ?? (singleJobMode ? jobsFilter[0] : null), jobsFilter: jobsFilter, singleJobMode: singleJobMode }), { exitOnCtrlC: false });
    try {
        await instance.waitUntilExit();
    }
    finally {
        restore();
        process.removeListener("exit", restore);
    }
}
