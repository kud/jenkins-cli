import { JenkinsJob, JenkinsBuild, JenkinsArtifact, JenkinsCrumb } from './types.js';

const getFetch = () => (globalThis.fetch as typeof fetch);
const joinUrl = (base: string, path: string): string => base.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

class HttpError extends Error {
  status: number;
  body?: string;
  constructor(status: number, message: string, body?: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

interface InternalRequestOptions {
  method?: string;
  headers?: Record<string,string>;
  as?: 'buffer';
  body?: any;
}

export class JenkinsClient {
  baseUrl: string;
  user: string;
  token: string;
  authHeader: string;
  timeout: number;
  retries: number;
  retryDelay: number;

  constructor(baseUrl: string, user: string, token: string, opts: { timeout?: number; retries?: number; retryDelay?: number } = {}) {
    this.baseUrl = baseUrl;
    this.user = user;
    this.token = token;
    this.authHeader = 'Basic ' + Buffer.from(`${user}:${token}`).toString('base64');
    const timeout = opts.timeout ?? 15000;
    const retries = opts.retries ?? 0;
    this.timeout = (Number.isFinite(timeout) && timeout > 0) ? timeout : 15000;
    this.retries = (Number.isFinite(retries) && retries >= 0 && retries < 10) ? retries : 0;
    this.retryDelay = opts.retryDelay ?? 500; // backoff base ms
  }

  private async _fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await getFetch()(url, { ...init, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(id);
    }
  }

  private _shouldRetry(res: Response | undefined, err: unknown, attempt: number): boolean {
    if (attempt >= this.retries) return false;
    if (err) return true; // network / abort
    if (!res) return true;
    if (res.status >= 500) return true;
    return false;
  }

  private _request(path: string, opts: InternalRequestOptions & { as: 'buffer' }): Promise<Buffer>;
  private _request<T = any>(path: string, opts?: InternalRequestOptions): Promise<T>;
  private async _request(path: string, opts: InternalRequestOptions = {}): Promise<any> {
    const url = joinUrl(this.baseUrl, path);
    let attempt = 0;
    while (true) { // retry loop
      let res: Response | undefined; let err: unknown;
      try {
        const { as, ...forward } = opts;
        res = await this._fetchWithTimeout(url, {
          headers: { Authorization: this.authHeader, ...(opts.headers || {}) },
          method: opts.method,
          body: opts.body,
          ...forward
        });
      } catch (e) {
        err = e;
      }
      if (!err && res && res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (opts.as === 'buffer') {
          const ab = await res.arrayBuffer();
            return Buffer.from(ab);
        }
        if (ct.includes('application/json')) return res.json();
        return res.text();
      }
      if (this._shouldRetry(res, err, attempt)) {
        await sleep(this.retryDelay * (attempt + 1));
        attempt++;
        continue;
      }
      if (err) {
        throw new HttpError(res?.status || 0, `Request failed ${url}: ${(err as Error).message}`);
      }
      const body = res ? (await res.text()).slice(0, 300) : '';
      throw new HttpError(res?.status || 0, `HTTP ${res?.status} ${res?.statusText}: ${body}`, body);
    }
  }

  private async _getCrumb(): Promise<JenkinsCrumb | null> {
    try {
      const c = await this._request<JenkinsCrumb>('crumbIssuer/api/json');
      if (c && typeof c === 'object' && (c.crumb || c.crumbRequestField)) return c;
      return null;
    } catch { return null; }
  }

  async getJob(job: string): Promise<JenkinsJob> {
    return this._request<JenkinsJob>(`job/${encodeURIComponent(job)}/api/json?depth=1`);
  }

  async getBuild(job: string, buildNumber?: number): Promise<JenkinsBuild> {
    if (!buildNumber) {
      const jobInfo = await this.getJob(job);
      const number = jobInfo.lastBuild?.number;
      if (!number) throw new Error('No lastBuild found');
      buildNumber = number;
    }
    // Request actions to get user/cause information
    return this._request<JenkinsBuild>(`job/${encodeURIComponent(job)}/${buildNumber}/api/json`);
  }

  async getConsoleText(job: string, buildNumber?: number): Promise<string> {
    if (!buildNumber) {
      const jobInfo = await this.getJob(job);
      const number = jobInfo.lastBuild?.number;
      if (!number) throw new Error('No lastBuild found');
      buildNumber = number;
    }
    const text = await this._request<string>(`job/${encodeURIComponent(job)}/${buildNumber}/consoleText`);
    return text;
  }

  async streamConsole(job: string, buildNumber: number | undefined, onChunk: (chunk: string) => void, intervalMs = 3000, opts: { signal?: AbortSignal } = {}): Promise<void> {
    if (!buildNumber) {
      const jobInfo = await this.getJob(job);
      const number = jobInfo.lastBuild?.number;
      if (!number) throw new Error('No lastBuild found');
      buildNumber = number;
    }
    let start = 0;
    const signal = opts.signal;
    const isAborted = () => signal && (signal.aborted || (signal as any).reason?.aborted);
    let finished = false;
    while (!finished) {
      if (isAborted()) break;
      const urlPath = `job/${encodeURIComponent(job)}/${buildNumber}/logText/progressiveText?start=${start}`;
      const url = joinUrl(this.baseUrl, urlPath);
      const res = await this._fetchWithTimeout(url, { headers: { Authorization: this.authHeader } });
      if (!res.ok) throw new Error(`HTTP ${res.status} streaming logs`);
      if (isAborted()) break;
      const text = await res.text();
      if (text && !isAborted()) onChunk(text);
      const newStart = parseInt(res.headers.get('x-text-size') || '0', 10);
      const more = res.headers.get('x-more-data') === 'true';
      start = newStart;
      if (!more) {
        const build = await this.getBuild(job, buildNumber);
        const building = build.building === true;
        if (!building) finished = true; else if (!isAborted()) await sleep(intervalMs);
      } else {
        if (isAborted()) break;
        await sleep(intervalMs);
      }
    }
  }

  async triggerBuild(job: string): Promise<{ queued: true; location: string | null }> {
    const crumb = await this._getCrumb();
    const headers: Record<string,string> = { Authorization: this.authHeader };
    if (crumb?.crumb && crumb.crumbRequestField) headers[crumb.crumbRequestField] = crumb.crumb;
    const url = joinUrl(this.baseUrl, `job/${encodeURIComponent(job)}/build`);
    const res = await this._fetchWithTimeout(url, { method: 'POST', headers });
    if ([200,201,202].includes(res.status)) return { queued: true, location: res.headers.get('location') };
    throw new Error(`Trigger failed: ${res.status} ${res.statusText}`);
  }

  async triggerBuildWithParameters(job: string, params: Record<string,string> = {}): Promise<{ queued: true; location: string | null }> {
    const crumb = await this._getCrumb();
    const headers: Record<string,string> = { Authorization: this.authHeader, 'Content-Type': 'application/x-www-form-urlencoded' };
    if (crumb?.crumb && crumb.crumbRequestField) headers[crumb.crumbRequestField] = crumb.crumb;
    const body = new URLSearchParams();
    for (const [k,v] of Object.entries(params)) body.append(k, v);
    const url = joinUrl(this.baseUrl, `job/${encodeURIComponent(job)}/buildWithParameters`);
    const res = await this._fetchWithTimeout(url, { method: 'POST', headers, body: body.toString() });
    if ([200,201,202].includes(res.status)) return { queued: true, location: res.headers.get('location') };
    throw new Error(`Parameterized trigger failed: ${res.status} ${res.statusText}`);
  }

  async stopBuild(job: string, buildNumber: number): Promise<{ stopped: true }> {
    const crumb = await this._getCrumb();
    const headers: Record<string,string> = { Authorization: this.authHeader };
    if (crumb?.crumb && crumb.crumbRequestField) headers[crumb.crumbRequestField] = crumb.crumb;
    const url = joinUrl(this.baseUrl, `job/${encodeURIComponent(job)}/${buildNumber}/stop`);
    const res = await this._fetchWithTimeout(url, { method: 'POST', headers });
    if (![200,201,202].includes(res.status)) throw new Error(`Stop failed: ${res.status} ${res.statusText}`);
    return { stopped: true };
  }

  async getQueue(): Promise<any> { // Domain typing optional for now
    return this._request<any>('queue/api/json');
  }

  async cancelQueueItem(id: number | string): Promise<{ cancelled: true }> {
    const crumb = await this._getCrumb();
    const headers: Record<string,string> = { Authorization: this.authHeader };
    if (crumb?.crumb && crumb.crumbRequestField) headers[crumb.crumbRequestField] = crumb.crumb;
    const url = joinUrl(this.baseUrl, `queue/cancelItem?id=${id}`);
    const res = await this._fetchWithTimeout(url, { method: 'POST', headers });
    if (![200,201,202,302].includes(res.status)) throw new Error(`Cancel queue failed: ${res.status} ${res.statusText}`);
    return { cancelled: true };
  }

  async getTestReport(job: string, buildNumber: number): Promise<any> { // refine later
    return this._request<any>(`job/${encodeURIComponent(job)}/${buildNumber}/testReport/api/json`);
  }

  async getPipelineStages(job: string, buildNumber: number): Promise<any> {
    return this._request<any>(`job/${encodeURIComponent(job)}/${buildNumber}/wfapi/describe`);
  }

  async listBuilds(job: string, limit = 10): Promise<JenkinsBuild[]> {
    const jobInfo = await this.getJob(job);
    const refs = (jobInfo.builds || []).map(b => (typeof b === 'number' ? { number: b } : b));
    const recent = refs.slice(0, limit);
    const detailed: JenkinsBuild[] = [];
    for (const ref of recent) {
      try { detailed.push(await this.getBuild(job, ref.number)); } catch { /* skip individual failures */ }
    }
    return detailed;
  }

  async getArtifacts(job: string, buildNumber?: number): Promise<{ build: JenkinsBuild; artifacts: JenkinsArtifact[] }> {
    const build = await this.getBuild(job, buildNumber);
    return { build, artifacts: build.artifacts || [] };
  }

  async downloadArtifact(job: string, buildNumber: number, relativePath: string): Promise<Buffer> {
    return this._request(`job/${encodeURIComponent(job)}/${buildNumber}/artifact/${relativePath}`, { as: 'buffer' });
  }

  async getSpecificJobs(jobNames: string[]): Promise<JenkinsJob[]> {
    const results: JenkinsJob[] = [];
    for (const jobName of jobNames) {
      try {
        const job = await this.getJob(jobName);
        if (!job.fullName) job.fullName = jobName;
        results.push(job);
      } catch (error) {
        // Add detailed error information based on the error type
        let errorMessage = `Failed to load job '${jobName}'`;
        
        if (error.status === 404) {
          errorMessage = `Job '${jobName}' not found`;
        } else if (error.status === 403) {
          errorMessage = `Access denied to job '${jobName}'`;
        } else if (error.status === 401) {
          errorMessage = `Authentication required for job '${jobName}'`;
        } else if (error.status >= 500) {
          errorMessage = `Server error loading job '${jobName}'`;
        } else if (error.message) {
          errorMessage = `${jobName}: ${error.message}`;
        }
        
        results.push({
          name: jobName,
          fullName: jobName,
          url: `${this.baseUrl}/job/${encodeURIComponent(jobName)}/`,
          color: 'disabled',
          error: errorMessage
        } as JenkinsJob);
      }
    }
    return results;
  }

  async searchJobs(query: string, limit = 50): Promise<JenkinsJob[]> {
    // New BFS recursive traversal without artificial depth restriction.
    // If limit === 0 treat as unlimited (subject to safety cap) to support large instances.
    const safetyCap = 5000; // Prevent pathological traversal from overwhelming UI.
    const effectiveLimit = (limit === 0) ? safetyCap : limit;

    // Start with shallow root job list; expand folders iteratively.
    let root: { jobs?: JenkinsJob[] } = { jobs: [] };
    try {
      root = await this._request<{ jobs?: JenkinsJob[] }>(`api/json?tree=jobs[name,url,color]`);
    } catch {
      return []; // Cannot even fetch root
    }

    const queue: Array<{ job: JenkinsJob; path: string[] }> = [];
    const results: JenkinsJob[] = [];

    const enqueueChildren = (parent: JenkinsJob, path: string[]) => {
      if (!parent.jobs) return;
      for (const child of parent.jobs) {
        const name = child.name || '';
        const fullParts = [...path, name];
        if (!child.fullName) child.fullName = fullParts.filter(Boolean).join('/');
        queue.push({ job: child, path: fullParts });
      }
    };

    // Prime queue with first level
    for (const j of (root.jobs || [])) {
      const name = j.name || '';
      if (!j.fullName) j.fullName = name;
      queue.push({ job: j, path: [name] });
    }

    const qLower = query.toLowerCase();

    while (queue.length > 0 && results.length < effectiveLimit) {
      const { job, path } = queue.shift()!;
      // If job might be a folder we attempt to fetch its children lazily.
      // Heuristic: folder jobs often have color undefined and need another API call to list nested jobs.
      // We call API only if we haven't already populated jobs array.
      if (job.jobs === undefined) {
        try {
          const data = await this._request<JenkinsJob>(`job/${encodeURIComponent(job.name || '')}/api/json?tree=name,url,color,jobs[name,url,color]`);
          if (data && data.jobs) {
            job.jobs = data.jobs;
            enqueueChildren(job, path);
          }
        } catch {/* ignore individual folder failures */}
      } else if (Array.isArray(job.jobs) && job.jobs.length > 0) {
        enqueueChildren(job, path);
      }

      const fullName = job.fullName || job.name || '';
      if (!qLower || fullName.toLowerCase().includes(qLower)) {
        results.push(job);
      }
    }

    return results.slice(0, effectiveLimit);
  }

  // Incremental full traversal with progress callback; returns full list (bounded by safety cap) once done.
  async searchJobsIncremental(query: string, opts: { limit?: number; onBatch?: (jobs: JenkinsJob[], stats: { processed: number; queued: number; total: number; }) => void; concurrency?: number } = {}): Promise<JenkinsJob[]> {
    const limit = opts.limit ?? 0; // 0 = unlimited
    const safetyCap = 5000;
    const effectiveLimit = (limit === 0) ? safetyCap : limit;
    const concurrency = Math.min(Math.max(opts.concurrency ?? 5, 1), 10);

    let root: { jobs?: JenkinsJob[] } = { jobs: [] };
    try {
      root = await this._request<{ jobs?: JenkinsJob[] }>(`api/json?tree=jobs[name,url,color]`);
    } catch {
      return [];
    }

    const queue: Array<{ job: JenkinsJob; path: string[] } > = [];
    const results: JenkinsJob[] = [];

    for (const j of (root.jobs || [])) {
      const name = j.name || '';
      if (!j.fullName) j.fullName = name;
      queue.push({ job: j, path: [name] });
    }

    const qLower = query.toLowerCase();
    let active = 0;
    let processed = 0;

    const maybeEmit = () => {
      if (opts.onBatch) opts.onBatch(results.slice(), { processed, queued: queue.length, total: results.length });
    };

    return await new Promise<JenkinsJob[]>((resolve) => {
      const pump = () => {
        if (results.length >= effectiveLimit) return resolve(results.slice(0, effectiveLimit));
        if (queue.length === 0 && active === 0) return resolve(results.slice(0, effectiveLimit));
        while (active < concurrency && queue.length > 0 && results.length < effectiveLimit) {
          const { job, path } = queue.shift()!;
          active++;
          (async () => {
            try {
              if (job.jobs === undefined) {
                try {
                  const data = await this._request<JenkinsJob>(`job/${encodeURIComponent(job.name || '')}/api/json?tree=name,url,color,jobs[name,url,color]`);
                  if (data && data.jobs) {
                    job.jobs = data.jobs;
                    for (const child of job.jobs) {
                      const cname = child.name || '';
                      const fullParts = [...path, cname];
                      if (!child.fullName) child.fullName = fullParts.filter(Boolean).join('/');
                      queue.push({ job: child, path: fullParts });
                    }
                  }
                } catch {/* ignore */}
              } else if (Array.isArray(job.jobs) && job.jobs.length) {
                for (const child of job.jobs) {
                  const cname = child.name || '';
                  const fullParts = [...path, cname];
                  if (!child.fullName) child.fullName = fullParts.filter(Boolean).join('/');
                  queue.push({ job: child, path: fullParts });
                }
              }
              const fullName = job.fullName || job.name || '';
              if (!qLower || fullName.toLowerCase().includes(qLower)) {
                results.push(job);
              }
            } finally {
              processed++;
              active--;
              maybeEmit();
              // Throttle UI churn slightly
              setTimeout(pump, 0);
            }
          })();
        }
      };
      maybeEmit();
      pump();
    });
  }
}
