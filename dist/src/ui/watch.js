import blessed from 'neo-blessed';
import { formatLogsChunk } from '../format.js';
export async function runWatch(client, { job, refreshInterval = 5000, forceBasicColor = false, noTerminfo = false }) {
    // Suppress terminal capability errors
    const originalConsoleError = console.error;
    console.error = (msg, ...args) => {
        const message = String(msg);
        if (message.includes('Setulc') || message.includes('tput') || message.includes('xterm-256color')) {
            return;
        }
        originalConsoleError(msg, ...args);
    };
    const isProblematicTerminal = process.platform === 'win32' ||
        process.env.CI ||
        process.env.TERM_PROGRAM === 'vscode' ||
        process.env.COLORTERM === 'truecolor';
    let screen;
    try {
        screen = blessed.screen({
            smartCSR: true,
            title: `Jenkins Watch: ${job}`,
            fullUnicode: !isProblematicTerminal,
            terminal: isProblematicTerminal ? 'xterm' : (process.env.TERM || 'xterm'),
            forceUnicode: !isProblematicTerminal,
            tput: !noTerminfo && !isProblematicTerminal,
            debug: false,
            warnings: false,
            colors: (forceBasicColor || isProblematicTerminal) ? 8 : 256,
            sendFocus: false,
            useBCE: false
        });
    }
    catch (termError) {
        screen = blessed.screen({
            smartCSR: false,
            title: `Jenkins Watch: ${job}`,
            fullUnicode: false,
            terminal: 'xterm',
            forceUnicode: false,
            tput: false,
            debug: false,
            warnings: false,
            colors: 8,
            sendFocus: false,
            useBCE: false
        });
    }
    // Status box at the top
    const statusBox = blessed.box({
        parent: screen,
        label: ` Job: ${job} `,
        top: 0,
        left: 0,
        width: '100%',
        height: 7,
        border: 'line',
        tags: true,
        style: {
            border: { fg: 'cyan' },
            label: { fg: 'cyan', bold: true }
        }
    });
    // Log box below
    const logBox = blessed.box({
        parent: screen,
        label: ' Console Output ',
        top: 7,
        left: 0,
        width: '100%',
        height: '100%-10',
        border: 'line',
        tags: true,
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        mouse: true,
        vi: true,
        scrollbar: {
            ch: '█',
            style: { fg: 'cyan' }
        },
        style: {
            border: { fg: 'green' },
            label: { fg: 'green', bold: true }
        }
    });
    // Control bar at the bottom
    const controlBar = blessed.box({
        parent: screen,
        bottom: 0,
        left: 0,
        height: 3,
        width: '100%',
        border: 'line',
        tags: true,
        style: {
            border: { fg: 'magenta' },
            fg: 'white'
        }
    });
    let latestBuild = null;
    let autoRefresh = true;
    let follow = false;
    let abortController = null;
    let refreshTimer = null;
    let isStreaming = false;
    const formatDuration = (milliseconds) => {
        if (!milliseconds)
            return 'N/A';
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) {
            const remainingMinutes = minutes % 60;
            return `${hours}h ${remainingMinutes}m`;
        }
        else if (minutes > 0) {
            const remainingSeconds = seconds % 60;
            return `${minutes}m ${remainingSeconds}s`;
        }
        else {
            return `${seconds}s`;
        }
    };
    const formatTimestamp = (timestamp) => {
        if (!timestamp)
            return 'N/A';
        const date = new Date(timestamp);
        return date.toLocaleString();
    };
    const getStatusIcon = (result, building) => {
        if (building)
            return '{blue-fg}RUNNING 🔄{/}';
        switch (result) {
            case 'SUCCESS': return '{green-fg}SUCCESS ✅{/}';
            case 'FAILURE': return '{red-fg}FAILURE ❌{/}';
            case 'ABORTED': return '{gray-fg}ABORTED ✂️{/}';
            case 'UNSTABLE': return '{yellow-fg}UNSTABLE ⚠️{/}';
            default: return '{cyan-fg}' + (result || 'UNKNOWN') + '{/}';
        }
    };
    const updateStatus = () => {
        if (!latestBuild) {
            statusBox.setContent('\n  {yellow-fg}Loading...{/}');
            screen.render();
            return;
        }
        const { number, result, building, duration, timestamp, url } = latestBuild;
        const status = getStatusIcon(result, building);
        const dur = formatDuration(duration);
        const time = formatTimestamp(timestamp);
        const content = `
  {bold}Build:{/} {white-fg}#${number}{/}  {bold}Status:{/} ${status}
  {bold}Duration:{/} {cyan-fg}${dur}{/}  {bold}Started:{/} {gray-fg}${time}{/}
  {bold}URL:{/} {blue-fg}${url || 'N/A'}{/}`;
        statusBox.setContent(content);
        screen.render();
    };
    const updateControlBar = () => {
        const autoRefreshText = autoRefresh ? '{green-fg}ON{/}' : '{red-fg}OFF{/}';
        const followText = follow ? '{green-fg}ON{/}' : '{red-fg}OFF{/}';
        const streamingText = isStreaming ? ' {yellow-fg}[Streaming...]{/}' : '';
        // Show current refresh interval (dynamic based on build state)
        const currentInterval = getRefreshInterval();
        const intervalText = currentInterval >= 30000
            ? `${currentInterval / 1000}s{gray-fg} (slow - build complete){/}`
            : `${currentInterval / 1000}s`;
        controlBar.setContent(`  Auto-refresh: ${autoRefreshText} (${intervalText}) | Follow: ${followText}${streamingText} | ` +
            `{magenta-fg}q{/}:quit {green-fg}r{/}:refresh {cyan-fg}t{/}:toggle-auto {yellow-fg}f{/}:follow {blue-fg}w{/}:browser`);
        screen.render();
    };
    const loadLatestBuild = async () => {
        try {
            const builds = await client.listBuilds(job, 1);
            if (builds && builds.length > 0) {
                latestBuild = builds[0];
                updateStatus();
                return latestBuild;
            }
        }
        catch (e) {
            statusBox.setContent(`\n  {red-fg}Error loading build: ${e.message}{/}`);
            screen.render();
        }
        return null;
    };
    const loadLogs = async () => {
        if (!latestBuild)
            return;
        try {
            logBox.setContent('{yellow-fg}Loading logs...{/}');
            screen.render();
            const text = await client.getConsoleText(job, latestBuild.number);
            const formatted = formatLogsChunk(text);
            logBox.setContent(formatted);
            // Auto-scroll to bottom
            logBox.setScrollPerc(100);
            screen.render();
        }
        catch (e) {
            logBox.setContent(`{red-fg}Error loading logs: ${e.message}{/}`);
            screen.render();
        }
    };
    const startFollow = async () => {
        if (!latestBuild || isStreaming)
            return;
        if (abortController) {
            abortController.abort();
        }
        abortController = new AbortController();
        isStreaming = true;
        updateControlBar();
        logBox.setContent('');
        screen.render();
        try {
            await client.streamConsole(job, latestBuild.number, (chunk) => {
                const formatted = formatLogsChunk(chunk);
                logBox.setContent(logBox.getContent() + formatted);
                // Auto-scroll to bottom during follow
                logBox.setScrollPerc(100);
                screen.render();
            }, 2000, { signal: abortController.signal });
        }
        catch (e) {
            if (e.name !== 'AbortError') {
                logBox.setContent(logBox.getContent() + `\n{red-fg}Stream error: ${e.message}{/}`);
                screen.render();
            }
        }
        finally {
            isStreaming = false;
            updateControlBar();
        }
    };
    const stopFollow = () => {
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        isStreaming = false;
        updateControlBar();
    };
    const refresh = async () => {
        const wasFollowing = follow && isStreaming;
        if (wasFollowing) {
            stopFollow();
        }
        await loadLatestBuild();
        if (follow) {
            await startFollow();
        }
        else {
            await loadLogs();
        }
        // Update control bar to show current refresh interval
        updateControlBar();
    };
    const getRefreshInterval = () => {
        if (!latestBuild)
            return refreshInterval;
        const { building, result } = latestBuild;
        // Fast refresh for running builds
        if (building) {
            return refreshInterval; // Default: 5s
        }
        // Slow refresh for completed builds (to detect new builds)
        // Terminal states: SUCCESS, FAILURE, ABORTED, UNSTABLE
        const isComplete = result && ['SUCCESS', 'FAILURE', 'ABORTED', 'UNSTABLE'].includes(result);
        if (isComplete) {
            return 30000; // 30 seconds
        }
        return refreshInterval;
    };
    const startAutoRefresh = () => {
        stopAutoRefresh(); // Clear any existing timer
        if (!autoRefresh)
            return;
        const scheduleNext = () => {
            if (!autoRefresh)
                return;
            const interval = getRefreshInterval();
            refreshTimer = setTimeout(async () => {
                // Don't auto-refresh if actively streaming
                if (!isStreaming) {
                    await refresh();
                    scheduleNext(); // Schedule next refresh with potentially new interval
                }
                else {
                    scheduleNext(); // Keep scheduling even when streaming
                }
            }, interval);
        };
        scheduleNext();
    };
    const stopAutoRefresh = () => {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
        }
    };
    // Key bindings
    screen.key(['q', 'C-c'], () => {
        stopAutoRefresh();
        stopFollow();
        process.exit(0);
    });
    screen.key('r', async () => {
        await refresh();
    });
    screen.key('t', () => {
        autoRefresh = !autoRefresh;
        if (autoRefresh) {
            startAutoRefresh();
        }
        else {
            stopAutoRefresh();
        }
        updateControlBar();
    });
    screen.key('f', async () => {
        follow = !follow;
        if (follow) {
            stopAutoRefresh(); // Stop auto-refresh when following
            await startFollow();
        }
        else {
            stopFollow();
            await loadLogs();
            startAutoRefresh(); // Resume auto-refresh when not following
        }
        updateControlBar();
    });
    screen.key('w', async () => {
        if (!latestBuild)
            return;
        const base = client.baseUrl.replace(/\/$/, '');
        const url = `${base}/job/${encodeURIComponent(job)}/${latestBuild.number}/`;
        const { exec } = await import('child_process');
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${opener} "${url}"`);
    });
    // Mouse scrolling for log box
    logBox.focus();
    // Initial load
    updateControlBar();
    await loadLatestBuild();
    await loadLogs();
    // Start auto-refresh
    if (autoRefresh) {
        startAutoRefresh();
    }
    screen.render();
}
