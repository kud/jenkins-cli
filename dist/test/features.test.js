import test from 'node:test';
import assert from 'node:assert/strict';
import { JenkinsClient } from '../src/jenkins-client.js';
// Controlled mock fetch for multiple behaviors
const calls = [];
let scenario = '';
const makeResponse = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'X',
    headers: { get: (k) => headers[k.toLowerCase()] },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)),
    clone: () => makeResponse(status, body, headers)
});
global.fetch = (async (url, opts) => {
    calls.push({ url, opts, scenario });
    if (scenario === 'list-builds') {
        if (url.includes('/api/json?depth=1')) {
            return makeResponse(200, { lastBuild: { number: 5 }, builds: [5, 4, 3, 2, 1].map(n => ({ number: n })) }, { 'content-type': 'application/json' });
        }
        if (/\/\d+\/api\/json$/.test(url)) {
            const num = parseInt(url.match(/\/(\d+)\/api\/json$/)[1], 10);
            return makeResponse(200, { number: num, building: false, result: 'SUCCESS' }, { 'content-type': 'application/json' });
        }
    }
    if (scenario === 'artifacts') {
        if (url.includes('/api/json?depth=1')) {
            return makeResponse(200, { lastBuild: { number: 9 }, builds: [{ number: 9 }] }, { 'content-type': 'application/json' });
        }
        if (url.endsWith('/9/api/json')) {
            return makeResponse(200, { number: 9, building: false, result: 'SUCCESS', artifacts: [
                    { fileName: 'report.txt', relativePath: 'report.txt' },
                    { fileName: 'app.jar', relativePath: 'build/app.jar' }
                ] }, { 'content-type': 'application/json' });
        }
        if (url.includes('/artifact/')) {
            return makeResponse(200, 'BINARY');
        }
    }
    if (scenario === 'search') {
        if (url.endsWith('/api/json?tree=jobs[name,url,color]')) {
            return makeResponse(200, { jobs: [
                    { name: 'compile-api' }, { name: 'deploy-service' }, { name: 'folderA' }, { name: 'test-ui' }
                ] }, { 'content-type': 'application/json' });
        }
        // folder expansion request
        if (url.includes('/job/folderA/api/json?tree=name,url,color,jobs[name,url,color]')) {
            return makeResponse(200, { name: 'folderA', jobs: [{ name: 'nested-job' }] }, { 'content-type': 'application/json' });
        }
    }
    if (scenario === 'retry') {
        // Only target the job metadata URL
        if (url.includes('/api/json?depth=1')) {
            const count = calls.filter(c => c.scenario === 'retry' && c.url.includes('/api/json?depth=1')).length;
            if (count < 3)
                return makeResponse(500, 'err');
            return makeResponse(200, { lastBuild: { number: 1 }, builds: [{ number: 1 }] }, { 'content-type': 'application/json' });
        }
    }
    return makeResponse(404, 'Not Found');
});
// listBuilds limit
test('listBuilds respects limit', async () => {
    scenario = 'list-builds';
    const client = new JenkinsClient('http://jenkins', 'u', 't');
    const builds = await client.listBuilds('job', 3);
    assert.equal(builds.length, 3);
    assert.deepEqual(builds.map(b => b.number), [5, 4, 3]);
});
// artifacts listing and download
test('artifacts listing & download', async () => {
    scenario = 'artifacts';
    const client = new JenkinsClient('http://jenkins', 'u', 't');
    const { artifacts, build } = await client.getArtifacts('job');
    assert.equal(build.number, 9);
    assert.equal(artifacts.length, 2);
    const buf = await client.downloadArtifact('job', 9, artifacts[0].relativePath);
    assert.ok(Buffer.isBuffer(buf));
});
// search jobs
test('searchJobs filters by substring & limit', async () => {
    scenario = 'search';
    const client = new JenkinsClient('http://jenkins', 'u', 't');
    const jobs = await client.searchJobs('api', 10);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].name, 'compile-api');
});
// bfs nested + unlimited
test('searchJobs BFS expands folders and supports unlimited (0)', async () => {
    scenario = 'search';
    const client = new JenkinsClient('http://jenkins', 'u', 't');
    const jobs = await client.searchJobs('', 0); // unlimited
    const names = jobs.map(j => j.name).sort();
    assert.ok(names.includes('nested-job'));
    assert.ok(names.includes('folderA'));
});
// retry logic
test('retries on 500 up to configured count', async () => {
    scenario = 'retry';
    const client = new JenkinsClient('http://jenkins', 'u', 't', { retries: 3, timeout: 5000 });
    const job = await client.getJob('anything');
    assert.equal(job.lastBuild.number, 1);
    const retryCalls = calls.filter(c => c.scenario === 'retry' && c.url.includes('/api/json?depth=1'));
    if (retryCalls.length < 3)
        console.error('DEBUG retryCalls length', retryCalls.length, retryCalls.map(c => c.url));
    assert.ok(retryCalls.length >= 3); // two failures + success
});
