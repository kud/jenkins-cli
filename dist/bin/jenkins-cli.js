#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import chalk from 'chalk';
import { loadConfig, saveConfig, resolveConfig, addServer, useServer, removeServer, listServers, CONFIG_FILE } from '../src/config.js';
import { JenkinsClient } from '../src/jenkins-client.js';
import { formatStatus, formatBuildList, formatError, formatLogsChunk } from '../src/format.js';
import { normalizeUrl, ensureScheme, parseBuildSpecifier } from '../src/url-utils.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
const program = new Command();
program
    .name('jenkins')
    .description('Lightweight Jenkins CLI (status, logs, trigger, list, artifacts, open, search, multi-server)')
    .version(pkg.version)
    .option('--url <url>', 'Jenkins base URL')
    .option('--user <user>', 'Jenkins username')
    .option('--token <token>', 'Jenkins API token')
    .option('--json', 'Raw JSON output', false)
    .option('--pretty', 'Colorised output', false)
    .option('--server <name>', 'Select configured server alias')
    .option('--timeout <ms>', 'Request timeout in milliseconds', process.env.JENKINS_TIMEOUT || '15000')
    .option('--retries <n>', 'Retry count for failed requests', process.env.JENKINS_RETRIES || '0')
    .option('--debug-config', 'Print raw & resolved configuration for troubleshooting', false)
    .option('-i, --interactive', 'Launch interactive multi-job explorer')
    .option('--basic-colors', 'Force basic (no truecolor) colors in TUIs')
    .option('--no-terminfo', 'Disable terminfo/tput features (avoids Setulc warnings)')
    .option('--project <job>', 'Preselect job in interactive explorer')
    .option('--jobs <jobs>', 'Filter/specify jobs in interactive mode (comma-separated). Single job hides Jobs panel.');
// Enhanced guidance for missing required positional arguments (non-interactive usage)
program.showHelpAfterError();
program.configureOutput({
    writeErr: (str) => {
        if (str && str.toLowerCase().includes('missing required argument')) {
            console.error(str.trim());
            console.error('\nExamples:\n  jenkins status my-job\n  jenkins logs my-job -f\n  jenkins console my-job 123\n  jenkins list my-job\n\nTip: Provide the job name (or full build URL). See `jenkins --help` for more.');
        }
        else {
            console.error(str);
        }
    }
});
const getClient = async () => {
    const globalOpts = program.opts();
    if (globalOpts.debugConfig)
        console.error('--- debug-config program.opts() ---', globalOpts);
    const fileConfig = loadConfig();
    if (globalOpts.debugConfig)
        console.error('--- debug-config fileConfig ---', fileConfig);
    const merged = resolveConfig({
        url: globalOpts.url,
        user: globalOpts.user,
        token: globalOpts.token,
        server: globalOpts.server
    });
    if (globalOpts.debugConfig) {
        try {
            const fs = await import('fs');
            let raw = '';
            try {
                raw = fs.readFileSync(CONFIG_FILE, 'utf8');
            }
            catch (_) {
                raw = '(missing)';
            }
            console.error('--- debug-config raw file ---');
            console.error(raw);
            console.error('--- debug-config resolved ---');
            console.error(merged);
            console.error('----------------------------');
        }
        catch (e) {
            console.error('debug-config error', e.message);
        }
    }
    if (!merged.url) {
        if (globalOpts.debugConfig) {
            console.error('DEBUG merged config missing url', merged);
        }
        console.error('Missing Jenkins URL. Configure via config set or --url (or set JENKINS_URL)');
        process.exit(1);
    }
    if (!merged.user || !merged.token) {
        console.error('Missing credentials. Provide --user/--token or config set (or set JENKINS_USER/JENKINS_TOKEN)');
        process.exit(1);
    }
    const timeout = parseInt(globalOpts.timeout, 10);
    const retries = parseInt(globalOpts.retries, 10);
    return new JenkinsClient(merged.url, merged.user, merged.token, { timeout: isNaN(timeout) ? undefined : timeout, retries: isNaN(retries) ? undefined : retries });
};
program.command('config')
    .description('Manage stored configuration & servers')
    .argument('[action]', 'set | show | add-server | use | remove-server | list-servers')
    .argument('[name]', 'Server alias (for server operations)')
    .option('--url <url>')
    .option('--user <user>')
    .option('--token <token>')
    .option('--show', 'Show current config')
    .action((action, name, options) => {
    try {
        const opts = options; // Commander v14 passes options object directly
        if (opts.show || action === 'show') {
            console.log(loadConfig());
            return;
        }
        if (action === 'set') {
            // Commander may place duplicated options at root or subcommand; support both.
            const root = program.opts();
            let url = opts.url || root.url;
            let user = opts.user || root.user;
            let token = opts.token || root.token;
            if (!url && !user && !token) {
                console.error('config set requires at least one of --url --user --token');
                process.exit(1);
            }
            const ensureSchemeLocal = (u) => ensureScheme(u);
            const update = {};
            if (url)
                update.url = ensureSchemeLocal(normalizeUrl(url));
            if (user)
                update.user = user;
            if (token)
                update.token = token;
            saveConfig(update);
            console.log(`Config updated: ${Object.keys(update).join(', ')}`);
            return;
        }
        if (action === 'add-server') {
            const { url, user, token } = opts;
            if (!name || !url || !user || !token) {
                console.error('config add-server <name> --url --user --token');
                process.exit(1);
            }
            addServer(name, { url: normalizeUrl(url), user, token });
            console.log(`Server '${name}' added.`);
            return;
        }
        if (action === 'use') {
            if (!name) {
                console.error('config use <name>');
                process.exit(1);
            }
            useServer(name);
            console.log(`Current server set to '${name}'.`);
            return;
        }
        if (action === 'remove-server') {
            if (!name) {
                console.error('config remove-server <name>');
                process.exit(1);
            }
            removeServer(name);
            console.log(`Server '${name}' removed.`);
            return;
        }
        if (action === 'list-servers') {
            const servers = listServers();
            console.log(servers);
            return;
        }
        console.log('Usage: config set | show | add-server | use | remove-server | list-servers');
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('console <jobOrUrl> [buildNumber]')
    .description('Show plain console output (alias of logs)')
    .action(async (jobOrUrl, buildNumber) => {
    try {
        const spec = parseBuildSpecifier(jobOrUrl);
        const job = spec.job;
        const num = buildNumber || spec.buildNumber;
        const client = await getClient();
        const text = await client.getConsoleText(job, num);
        process.stdout.write(text);
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('status <jobOrUrl> [buildNumber]')
    .description('Show build status by job or full build URL')
    .action(async (jobOrUrl, buildNumber) => {
    try {
        const spec = parseBuildSpecifier(jobOrUrl);
        let job = spec.job;
        let num = buildNumber || spec.buildNumber;
        const client = await getClient();
        // If full build URL provided with different base, warn (not auto-switching server yet)
        if ((spec.type === 'build-url' || spec.type === 'job-url') && spec.baseUrl && client.baseUrl.replace(/\/$/, '') !== spec.baseUrl) {
            console.error('Warning: build URL base differs from configured Jenkins URL; using configured URL for API calls.');
        }
        const jsonFlag = program.opts().json;
        const pretty = program.opts().pretty;
        const build = await client.getBuild(job, num);
        if (jsonFlag) {
            console.log(JSON.stringify(build, null, 2));
        }
        else {
            console.log(formatStatus(build, { pretty }));
        }
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('logs <jobOrUrl> [buildNumber]')
    .description('Fetch console logs (optionally follow) or via build URL')
    .option('-f, --follow', 'Stream logs until completion')
    .option('--json', 'Output JSON object { text } (disabled with --follow)')
    .action(async (jobOrUrl, buildNumber, cmd) => {
    const follow = cmd.follow;
    try {
        const spec = parseBuildSpecifier(jobOrUrl);
        let job = spec.job;
        let num = buildNumber || spec.buildNumber;
        const client = await getClient();
        if ((spec.type === 'build-url' || spec.type === 'job-url') && spec.baseUrl && client.baseUrl.replace(/\/$/, '') !== spec.baseUrl) {
            console.error('Warning: build URL base differs from configured Jenkins URL; using configured URL.');
        }
        if (follow && cmd.json) {
            console.error('--json not supported with --follow');
            process.exit(1);
        }
        if (!follow) {
            const text = await client.getConsoleText(job, num);
            if (cmd.json) {
                console.log(JSON.stringify({ job, build: num ? parseInt(num, 10) : undefined, text }, null, 2));
            }
            else {
                process.stdout.write(text);
            }
        }
        else {
            await client.streamConsole(job, num, (chunk) => {
                process.stdout.write(formatLogsChunk(chunk));
            });
        }
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('trigger <jobOrUrl>')
    .description('Trigger a new build by job or job URL (use build --param for parameters)')
    .action(async (jobOrUrl) => {
    try {
        const spec = parseBuildSpecifier(jobOrUrl);
        if (spec.type === 'build-url') {
            console.error('Cannot trigger using a specific build URL; supply job or job URL.');
            process.exit(1);
        }
        const client = await getClient();
        const res = await client.triggerBuild(spec.job);
        console.log(res);
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('build <job>')
    .description('Trigger a build, optionally with parameters (repeat --param)')
    .option('--param <k=v>', 'Parameter (repeatable)', (v, p) => { p.push(v); return p; }, [])
    .option('--wait', 'Wait for build to start and show build URL')
    .option('--json', 'Output raw JSON response')
    .action(async (job, cmd) => {
    try {
        const client = await getClient();
        const params = {};
        for (const kv of cmd.param) {
            const idx = kv.indexOf('=');
            if (idx === -1) {
                console.error('Param must be key=value: ' + kv);
                process.exit(1);
            }
            const k = kv.slice(0, idx);
            const v = kv.slice(idx + 1);
            params[k] = v;
        }
        const res = Object.keys(params).length ? await client.triggerBuildWithParameters(job, params) : await client.triggerBuild(job);
        if (cmd.json) {
            console.log(JSON.stringify(res, null, 2));
            return;
        }
        console.log(chalk.green(`✓ Build queued successfully for '${chalk.bold(job)}'`));
        if (Object.keys(params).length > 0) {
            console.log(chalk.cyan('\nParameters:'));
            for (const [k, v] of Object.entries(params)) {
                console.log(chalk.cyan(`  ${chalk.bold(k)}: `) + chalk.white(v));
            }
        }
        if (cmd.wait && res.location) {
            console.log(chalk.gray('\nWaiting for build to start...'));
            const buildInfo = await client.waitForBuild(res.location);
            if (buildInfo) {
                const consoleUrl = buildInfo.buildUrl.replace(/\/$/, '') + '/console';
                console.log(chalk.green(`\n✓ Build #${chalk.bold(buildInfo.buildNumber)} started`));
                console.log(chalk.blue('Build URL: ') + chalk.underline(buildInfo.buildUrl));
                console.log(chalk.blue('Console URL: ') + chalk.underline(consoleUrl));
                console.log(chalk.yellow('\nNext steps:'));
                console.log(chalk.white(`  jenkins logs ${job} ${buildInfo.buildNumber} -f`));
                console.log(chalk.white(`  jenkins status ${job} ${buildInfo.buildNumber}`));
            }
            else {
                console.log(chalk.yellow('\n⚠ Build did not start within timeout period'));
                console.log(chalk.white('Use `jenkins list` to check if it started later'));
            }
        }
        else {
            console.log(chalk.yellow('\nNext steps:'));
            console.log(chalk.white(`  jenkins list ${job}`));
            console.log(chalk.white(`  jenkins logs ${job} -f`));
            console.log(chalk.gray(`\nTip: Use --wait to automatically get the build URL when it starts`));
        }
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('stop <job> <buildNumber>')
    .description('Stop/abort a running build')
    .action(async (job, buildNumber) => {
    try {
        const client = await getClient();
        const res = await client.stopBuild(job, buildNumber);
        console.log(res);
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('queue')
    .description('List queue items')
    .action(async () => {
    try {
        const client = await getClient();
        const q = await client.getQueue();
        const jsonFlag = program.opts().json;
        if (jsonFlag)
            console.log(JSON.stringify(q, null, 2));
        else
            console.log((q.items || []).map(i => `${i.id}\t${i.task?.name || ''}\tblocked=${i.blocked} buildable=${i.buildable}`).join('\n'));
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('queue-cancel <id>')
    .description('Cancel a queue item by id')
    .action(async (id) => { try {
    const client = await getClient();
    const res = await client.cancelQueueItem(id);
    console.log(res);
}
catch (e) {
    formatError(e);
    process.exit(1);
} });
program.command('test-report <job> <buildNumber>')
    .description('Fetch JUnit test report summary for a build')
    .action(async (job, buildNumber) => {
    try {
        const client = await getClient();
        const rep = await client.getTestReport(job, buildNumber);
        const jsonFlag = program.opts().json;
        if (jsonFlag)
            console.log(JSON.stringify(rep, null, 2));
        else {
            const total = rep.totalCount;
            const fail = rep.failCount;
            const skip = rep.skipCount;
            console.log(`# Tests: ${total}  Failed: ${fail}  Skipped: ${skip}`);
            if (rep.suites) {
                rep.suites.slice(0, 5).forEach(s => console.log(`- ${s.name} ${s.cases?.length || 0} cases`));
                if (rep.suites.length > 5)
                    console.log(`... (${rep.suites.length - 5} more suites)`);
            }
        }
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('stages <job> <buildNumber>')
    .description('Fetch pipeline stages (workflow-api plugin required)')
    .action(async (job, buildNumber) => {
    try {
        const client = await getClient();
        const data = await client.getPipelineStages(job, buildNumber);
        const jsonFlag = program.opts().json;
        if (jsonFlag)
            console.log(JSON.stringify(data, null, 2));
        else {
            if (data.stages) {
                data.stages.forEach(s => console.log(`${s.id}\t${s.name}\t${s.status}\t${Math.round((s.durationMillis || 0) / 1000)}s`));
            }
            else
                console.log('No stages');
        }
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('list <jobOrUrl>')
    .description('List recent builds for a job (by name or URL)')
    .option('-l, --limit <n>', 'Limit number of builds', '10')
    .action(async (jobOrUrl, cmd) => {
    try {
        const spec = parseBuildSpecifier(jobOrUrl);
        const client = await getClient();
        const jsonFlag = program.opts().json;
        const pretty = program.opts().pretty;
        const limit = parseInt(cmd.limit, 10) || 10;
        const builds = await client.listBuilds(spec.job, limit);
        if (jsonFlag) {
            console.log(JSON.stringify(builds, null, 2));
        }
        else {
            console.log(formatBuildList(builds, { pretty }));
        }
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('artifacts <jobOrUrl> [buildNumber]')
    .description('List or download artifacts for a build (job name or build URL)')
    .option('-o, --output <dir>', 'Download all artifacts to directory')
    .option('-p, --pattern <glob>', 'Filter artifacts by substring (simple match)')
    .action(async (jobOrUrl, buildNumber, cmd) => {
    try {
        const spec = parseBuildSpecifier(jobOrUrl);
        const job = spec.job;
        const num = buildNumber || spec.buildNumber;
        const client = await getClient();
        const { artifacts, build } = await client.getArtifacts(job, num);
        let list = artifacts;
        if (cmd.pattern) {
            const pat = cmd.pattern.toLowerCase();
            list = list.filter(a => a.fileName.toLowerCase().includes(pat) || a.relativePath.toLowerCase().includes(pat));
        }
        if (!cmd.output) {
            console.log(list.map(a => `${a.fileName}\t${a.relativePath}\t${a.size || ''}`).join('\n'));
            return;
        }
        const fs = await import('fs');
        const path = await import('path');
        fs.mkdirSync(cmd.output, { recursive: true });
        for (const a of list) {
            const buf = await client.downloadArtifact(job, build.number, a.relativePath);
            const outFile = path.join(cmd.output, a.fileName);
            fs.writeFileSync(outFile, buf);
            console.log(`Saved ${outFile}`);
        }
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('open <jobOrUrl> [buildNumber]')
    .description('Open job or build in default browser (name or URL)')
    .action(async (jobOrUrl, buildNumber) => {
    try {
        const spec = parseBuildSpecifier(jobOrUrl);
        const client = await getClient();
        const base = client.baseUrl.replace(/\/$/, '');
        const num = buildNumber || spec.buildNumber;
        let url;
        if (num) {
            url = `${base}/job/${encodeURIComponent(spec.job)}/${num}/`;
        }
        else {
            url = `${base}/job/${encodeURIComponent(spec.job)}/`;
        }
        const { exec } = await import('child_process');
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${opener} "${url}"`);
        console.log(url);
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('ui <job>')
    .description('Interactive TUI for a job (build list + logs)')
    .option('-l, --limit <n>', 'Limit builds listed', '10')
    .action(async (job, cmd) => {
    try {
        const client = await getClient();
        const { runTUI } = await import('../src/ui/tui.js');
        const limit = parseInt(cmd.limit, 10) || 10;
        await runTUI(client, { job, limit });
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('watch <job>')
    .description('Watch latest build of a job with auto-refresh (focused dashboard)')
    .option('-i, --interval <ms>', 'Auto-refresh interval in milliseconds', '5000')
    .action(async (job, cmd) => {
    try {
        const client = await getClient();
        const { runWatch } = await import('../src/ui/watch.js');
        const root = program.opts();
        const refreshInterval = parseInt(cmd.interval, 10) || 5000;
        await runWatch(client, {
            job,
            refreshInterval,
            forceBasicColor: !!root.basicColors,
            noTerminfo: !!root.noTerminfo
        });
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('interactive')
    .description('Interactive multi-job explorer (jobs, builds, logs)')
    .option('-j, --jobs-limit <n>', 'Set manual job cap (default unlimited; 0 = unlimited)', '0')
    .option('-b, --builds-limit <n>', 'Max builds per job', '15')
    .action(async (cmd) => {
    try {
        const client = await getClient();
        const { runInteractive } = await import('../src/ui/interactive.js');
        const root = program.opts();
        const jobsLimitVal = parseInt(cmd.jobsLimit, 10);
        const jobSearchLimit = isNaN(jobsLimitVal) ? 0 : jobsLimitVal; // 0 => unlimited default
        const jobsFilter = root.jobs ? root.jobs.split(',').map(j => j.trim()).filter(Boolean) : null;
        await runInteractive(client, { jobSearchLimit, buildsLimit: parseInt(cmd.buildsLimit, 10) || 15, forceBasicColor: !!root.basicColors, preselectJob: root.project || null, noTerminfo: !!root.noTerminfo, jobsFilter });
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
program.command('search <text>')
    .description('Search jobs by substring')
    .option('-l, --limit <n>', 'Limit results', '50')
    .action(async (text, cmd) => {
    try {
        const client = await getClient();
        const limit = parseInt(cmd.limit, 10) || 50;
        const jobs = await client.searchJobs(text, limit);
        console.log(jobs.map(j => j.name).join('\n'));
    }
    catch (e) {
        formatError(e);
        process.exit(1);
    }
});
// Root action: if no subcommand and -i provided, launch interactive; else show help.
program.action(async () => {
    const opts = program.opts();
    if (opts.interactive) {
        try {
            const client = await getClient();
            const { runInteractive } = await import('../src/ui/interactive.js');
            const pre = opts.project || null;
            const jobsFilter = opts.jobs ? opts.jobs.split(',').map(j => j.trim()).filter(Boolean) : null;
            await runInteractive(client, { forceBasicColor: !!opts.basicColors, preselectJob: pre, noTerminfo: !!opts.noTerminfo, jobsFilter });
        }
        catch (e) {
            formatError(e);
            process.exit(1);
        }
    }
    else {
        if (opts.jobs) {
            console.error('Error: --jobs option only works with interactive mode (-i or --interactive)');
            console.error('');
            console.error('Examples:');
            console.error('  jenkins -i --jobs "my-job"');
            console.error('  jenkins --interactive --jobs "job1,job2"');
            console.error('');
            console.error('For non-interactive usage, use specific commands:');
            console.error('  jenkins status my-job');
            console.error('  jenkins logs my-job -f');
            console.error('  jenkins list my-job');
            process.exit(1);
        }
        program.outputHelp();
    }
});
program.parseAsync(process.argv);
