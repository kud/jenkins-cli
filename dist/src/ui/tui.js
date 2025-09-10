import blessed from 'neo-blessed';
import { formatLogsChunk } from '../format.js';
export async function runTUI(client, { job, limit = 10 }) {
    const screen = blessed.screen({ smartCSR: true, title: 'Jenkins CLI' });
    const layout = blessed.box({ parent: screen, top: 0, left: 0, width: '100%', height: '100%' });
    const buildsBox = blessed.list({
        parent: layout,
        label: '{blue-fg} Builds {/}',
        top: 0,
        left: 0,
        width: '30%',
        height: '80%',
        keys: true,
        mouse: true,
        border: 'line',
        tags: true,
        style: { selected: { bg: 'blue', fg: 'white' }, border: { fg: 'blue' } }
    });
    const logBox = blessed.box({
        parent: layout,
        label: '{cyan-fg} Logs {/}',
        top: 0,
        left: '30%',
        width: '70%',
        height: '80%',
        tags: true,
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        mouse: true,
        vi: true,
        border: 'line',
        style: { border: { fg: 'cyan' } }
    });
    const statusBar = blessed.box({
        parent: layout,
        bottom: 0,
        left: 0,
        height: 3,
        width: '100%',
        border: 'line',
        tags: true,
        style: { border: { fg: 'magenta' }, fg: 'white' },
        content: '{magenta-fg}q{/}-quit {green-fg}r{/}-refresh {cyan-fg}f{/}-follow'
    });
    let currentJob = job;
    let builds = [];
    let follow = false;
    let abortController = null;
    let selectedBuildNumber = null;
    let loading = false;
    const setStatus = (text) => {
        // Basic heuristics for colouring
        let msg = text
            .replace(/(Loaded builds)/, '{bold}{green-fg}$1{/}')
            .replace(/(Loading builds\.\.\.)/, '{bold}{yellow-fg}$1{/}')
            .replace(/(Error[^:]*:)/, '{bold}{red-fg}$1{/}')
            .replace(/(Follow ON)/, '{bold}{green-bg}{black-fg} $1 {/}')
            .replace(/(Follow OFF)/, '{bold}{gray-fg}$1{/}');
        statusBar.setContent(`{bold}{green-fg}Status:{/} ${msg} {dim}| {magenta-fg}q{/} quit | {green-fg}r{/} refresh | {cyan-fg}f{/} follow{/}`);
        screen.render();
    };
    const refreshBuilds = async () => {
        if (!currentJob)
            return;
        loading = true;
        setStatus('Loading builds...');
        try {
            builds = await client.listBuilds(currentJob, limit);
            buildsBox.setItems(builds.map(b => `#${b.number} ${b.building ? 'RUNNING' : (b.result || '')}`));
            buildsBox.select(0);
            selectedBuildNumber = builds[0]?.number;
            setStatus('Loaded builds. q:quit r:refresh f:follow');
        }
        catch (e) {
            setStatus('Error loading builds: ' + e.message);
        }
        finally {
            loading = false;
            screen.render();
        }
    };
    const loadLogs = async (num) => {
        if (!currentJob || !num)
            return;
        logBox.setContent('Fetching logs...');
        screen.render();
        try {
            const text = await client.getConsoleText(currentJob, num);
            logBox.setContent(formatLogsChunk(text));
        }
        catch (e) {
            logBox.setContent('Error: ' + e.message);
        }
        screen.render();
    };
    const startFollow = async (num) => {
        if (!currentJob || !num)
            return;
        if (abortController)
            abortController.abort();
        abortController = new AbortController();
        logBox.setContent('Following logs...');
        screen.render();
        try {
            await client.streamConsole(currentJob, num, (chunk) => {
                logBox.setContent(logBox.getContent() + formatLogsChunk(chunk));
                logBox.setScrollPerc(100);
                screen.render();
            }, 2000, { signal: abortController.signal });
            setStatus(`Completed build #${num}. q:quit r:refresh f:follow`);
        }
        catch (e) {
            if (e.name === 'AbortError') {
                setStatus('Follow aborted');
            }
            else {
                setStatus('Follow error: ' + e.message);
            }
        }
    };
    buildsBox.on('select', async (item, index) => {
        const b = builds[index];
        if (!b)
            return;
        selectedBuildNumber = b.number;
        if (follow) {
            startFollow(selectedBuildNumber);
        }
        else {
            loadLogs(selectedBuildNumber);
        }
    });
    screen.key(['q', 'C-c'], () => {
        if (abortController)
            abortController.abort();
        return process.exit(0);
    });
    screen.key('r', async () => {
        if (loading)
            return;
        await refreshBuilds();
        if (selectedBuildNumber)
            loadLogs(selectedBuildNumber);
    });
    screen.key('f', async () => {
        follow = !follow;
        setStatus((follow ? 'Follow ON' : 'Follow OFF') + ' q:quit r:refresh f:follow');
        if (follow && selectedBuildNumber)
            startFollow(selectedBuildNumber);
        if (!follow && abortController)
            abortController.abort();
    });
    await refreshBuilds();
    if (selectedBuildNumber)
        loadLogs(selectedBuildNumber);
    buildsBox.focus();
    screen.render();
}
