import type { Job, Project, ChatSession, DockingParams, BatchDockingParams, DiffDockParams, StructurePredictionParams, SandboxParams, McpCallResult, CreditQuota, CreditLogResponse, Boltz2JobParams, PricingCatalog } from './types.js';

export class M3triqClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private get headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 402) {
        let code = '';
        try { const j = JSON.parse(text); code = j.code || j.error || ''; } catch { /* not JSON */ }
        if (code === 'subscription_required') {
          throw new Error('Your free trial has ended. Subscribe to Pro to continue:\n  console.m3triq.com/profile');
        }
        throw new Error('Out of credits. Top up or subscribe at console.m3triq.com/profile');
      }
      throw new Error(`API error ${res.status}: ${text.substring(0, 200)}`);
    }

    return res.json() as Promise<T>;
  }

  async listProjects(): Promise<Project[]> {
    const data = await this.request<{ results?: Project[] } | Project[]>('GET', '/api/membership/projects/');
    return Array.isArray(data) ? data : (data.results || []);
  }

  async getProject(projectId: string): Promise<Project> {
    return this.request<Project>('GET', `/api/membership/projects/${projectId}/`);
  }

  // ── Chat Sessions ─────────────────────────────────────────────

  async listSessions(projectId: string, limit = 20): Promise<ChatSession[]> {
    const data = await this.request<{ results?: ChatSession[] } | ChatSession[]>(
      'GET',
      `/api/membership/sessions/?project=${projectId}&page_size=${limit}`,
    );
    return Array.isArray(data) ? data : (data.results || []);
  }

  async getSession(sessionId: string): Promise<ChatSession> {
    return this.request<ChatSession>('GET', `/api/membership/sessions/${sessionId}/`);
  }

  async getJob(jobId: string): Promise<Job> {
    return this.request<Job>('GET', `/api/jobs/${jobId}/`);
  }

  async listJobs(projectId: string, limit = 20): Promise<Job[]> {
    const data = await this.request<{ results?: Job[] } | Job[]>(
      'GET',
      `/api/jobs/?project_id=${projectId}&page_size=${limit}`,
    );
    return Array.isArray(data) ? data : (data.results || []);
  }

  async createDockingJob(params: DockingParams): Promise<{ job_id: string }> {
    return this.request<{ job_id: string }>('POST', '/api/jobs/create_molecular_docking/', params);
  }

  async createBatchDockingJob(params: BatchDockingParams): Promise<{ job_id: string }> {
    return this.request<{ job_id: string }>('POST', '/api/jobs/create_batch_docking/', params);
  }

  // ── Project Data ──────────────────────────────────────────────

  async listProjectData(projectId: string): Promise<Array<Record<string, unknown>>> {
    const data = await this.request<{ results?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
      'GET',
      `/api/membership/projects/${projectId}/data/`,
    );
    return Array.isArray(data) ? data : (data.results || []);
  }

  async getProjectData(projectId: string, dataId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'GET',
      `/api/membership/projects/${projectId}/data/${dataId}/`,
    );
  }

  // ── Docking (continued) ──────────────────────────────────────

  async createDiffDockJob(params: DiffDockParams): Promise<{ job_id: string }> {
    return this.request<{ job_id: string }>('POST', '/api/jobs/create_diffdock_prediction/', params);
  }

  async createRFAntibodyJob(params: {
    project_id: string;
    title: string;
    job_type: string;
    antibody_type: string;
  }): Promise<{ job_id: string }> {
    // Uses internal endpoint — needs X-Internal-Service header
    const url = `${this.baseUrl}/api/jobs/create_prediction_internal/`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.headers,
        'X-Internal-Service': 'true',
      },
      body: JSON.stringify({
        project_id: params.project_id,
        job_type: params.job_type,
        title: params.title,
        result_data: { antibody_type: params.antibody_type },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text.substring(0, 200)}`);
    }
    return res.json() as Promise<{ job_id: string }>;
  }

  async callbackJob(jobId: string, data: {
    status: string;
    percentage?: number;
    message?: string;
    result?: unknown;
  }): Promise<void> {
    const url = `${this.baseUrl}/api/jobs/${jobId}/cloud-callback/`;
    const payload = { ...data, message: data.message?.substring(0, 190) };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Callback error ${res.status}: ${text.substring(0, 200)}`);
    }
  }

  async createStructurePrediction(params: StructurePredictionParams): Promise<{ job_id: string }> {
    const endpoint = params.method === 'alphafold2'
      ? '/api/jobs/create_alphafold2_prediction/'
      : '/api/jobs/create_esmfold_prediction/';
    return this.request<{ job_id: string }>('POST', endpoint, params);
  }

  async createEsmfold2Job(params: {
    project_id: string;
    chains: { id: string; sequence: string }[];
    title?: string;
    num_loops?: number;
    num_sampling_steps?: number;
    num_diffusion_samples?: number;
    seed?: number;
  }): Promise<{ job_id: string }> {
    return this.request<{ job_id: string }>('POST', '/api/jobs/create_esmfold2_prediction/', params);
  }

  async createEsmcEmbedJob(params: {
    project_id: string;
    sequences: string[];
    title?: string;
    return_layer?: string;
  }): Promise<{ job_id: string }> {
    return this.request<{ job_id: string }>('POST', '/api/jobs/create_esmc_embed/', params);
  }

  async createEsmfold2BatchJob(params: {
    project_id: string;
    inputs: { label?: string; chains: { id: string; sequence: string }[];
              num_loops?: number; num_sampling_steps?: number;
              num_diffusion_samples?: number; seed?: number }[];
    title?: string;
    default_num_loops?: number;
    default_num_sampling_steps?: number;
    default_num_diffusion_samples?: number;
  }): Promise<{ job_id: string }> {
    return this.request<{ job_id: string }>('POST', '/api/jobs/create_esmfold2_batch/', params);
  }

  async createMsaJob(params: {
    project_id: string;
    chains: { id: string; sequence: string }[];
    depth: 'standard' | 'exhaustive' | 'custom';
    pair: boolean;
    templates?: boolean;
    custom?: { databases: string[]; max_sequences?: number; pair?: boolean };
    title?: string;
  }): Promise<{ job_id: string; task_id?: string; depth?: string; n_chains?: number }> {
    // MSA generation is an async job created via the internal prediction endpoint
    // (same path Boltz-2 uses). The server's is_msa branch keys off job_type.
    const url = `${this.baseUrl}/api/jobs/create_prediction_internal/`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers, 'X-Internal-Service': 'true' },
      body: JSON.stringify({
        project_id: params.project_id,
        job_type: 'msa_generation',
        title: params.title,
        chains: params.chains,
        depth: params.depth,
        pair: params.pair,
        templates: params.templates ?? false,
        ...(params.custom ? { custom: params.custom } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text.substring(0, 200)}`);
    }
    return res.json() as Promise<{ job_id: string; task_id?: string; depth?: string; n_chains?: number }>;
  }

  async createBoltz2Job(params: Boltz2JobParams): Promise<{ job_id: string }> {
    // Boltz-2 prediction is run client-side via the agents MCP, then saved here as a completed job.
    // Mirrors the RFantibody internal flow but with status='completed' and result_data already populated.
    const url = `${this.baseUrl}/api/jobs/create_prediction_internal/`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.headers,
        'X-Internal-Service': 'true',
      },
      body: JSON.stringify({
        project_id: params.project_id,
        job_type: 'boltz2_prediction',
        title: params.title,
        description: params.description ?? '',
        result_data: params.result_data,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text.substring(0, 200)}`);
    }
    return res.json() as Promise<{ job_id: string }>;
  }

  async createOpenfold3Job(params: Boltz2JobParams): Promise<{ job_id: string }> {
    // OpenFold3 prediction runs client-side via the agents MCP, then is saved here
    // as a completed job (same internal path Boltz-2 uses; server is_openfold3 branch).
    const url = `${this.baseUrl}/api/jobs/create_prediction_internal/`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers, 'X-Internal-Service': 'true' },
      body: JSON.stringify({
        project_id: params.project_id,
        job_type: 'openfold3_prediction',
        title: params.title,
        description: params.description ?? '',
        result_data: params.result_data,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text.substring(0, 200)}`);
    }
    return res.json() as Promise<{ job_id: string }>;
  }

  async createSandboxJob(params: SandboxParams): Promise<{ job_id: string }> {
    return this.request<{ job_id: string }>('POST', '/api/jobs/create_sandbox_job/', params);
  }

  // ── Credits ──────────────────────────────────────────────────

  async getCredits(): Promise<CreditQuota> {
    return this.request<CreditQuota>('GET', '/api/membership/user/credits/');
  }

  async getCreditLog(params: {
    page?: number;
    pageSize?: number;
    event?: string;
    since?: string;
    until?: string;
  } = {}): Promise<CreditLogResponse> {
    const q = new URLSearchParams();
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('page_size', String(params.pageSize));
    if (params.event) q.set('event', params.event);
    if (params.since) q.set('since', params.since);
    if (params.until) q.set('until', params.until);
    const qs = q.toString();
    return this.request<CreditLogResponse>(
      'GET',
      `/api/membership/user/credits/log/${qs ? `?${qs}` : ''}`,
    );
  }

  async getPricing(): Promise<PricingCatalog> {
    return this.request<PricingCatalog>('GET', '/api/membership/billing/pricing/');
  }
}

/**
 * Client for the agents service (MCP tool calls).
 * Separate from M3triqClient because it talks to a different host.
 */
export class AgentsClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async callMcpTool(server: string, tool: string, params: Record<string, unknown> = {}): Promise<McpCallResult> {
    const url = `${this.baseUrl}/mcp/call`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server, tool, params }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MCP call failed (${res.status}): ${text.substring(0, 200)}`);
    }

    const data = await res.json() as McpCallResult;
    if (data.error) {
      throw new Error(`MCP error: ${data.error}`);
    }

    // Unwrap nested MCP response: { result: { result: { content: [{ text: "JSON" }] } } }
    return unwrapMcpResponse(data);
  }
}

/**
 * Unwrap the nested MCP response format.
 * The agents /mcp/call endpoint returns: { result: { result: { content: [{ text: "JSON" }] } } }
 * We want to extract the parsed JSON from the innermost text content.
 */
function unwrapMcpResponse(data: McpCallResult): McpCallResult {
  const content = findContent(data);
  if (content) {
    const textItem = content.find((c: Record<string, unknown>) => c.type === 'text' && typeof c.text === 'string');
    if (textItem) {
      try {
        return JSON.parse(textItem.text as string) as McpCallResult;
      } catch {
        return { result: textItem.text } as McpCallResult;
      }
    }
  }
  return data;
}

function findContent(obj: unknown): Array<Record<string, unknown>> | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (Array.isArray(o.content)) return o.content as Array<Record<string, unknown>>;
  if (o.result && typeof o.result === 'object') return findContent(o.result);
  return null;
}
