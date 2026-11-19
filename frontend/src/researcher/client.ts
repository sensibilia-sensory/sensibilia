import type { components, paths } from '../api-schema';
export type Study = components['schemas']['StudyRead'];
export type Version = components['schemas']['VersionRead'];
export type Test = components['schemas']['TestRead'];
export type Method = components['schemas']['TestTypeRead'];
export type Report = components['schemas']['ValidationReport'];
export type Flow = components['schemas']['DraftFlowV2-Input'];
type Create = paths['/studies']['post']['requestBody']['content']['application/json'];
type SaveForm =
  paths['/studies/{study_id}/versions/{version_id}/form']['put']['requestBody']['content']['application/json'];
type SaveTest = components['schemas']['TestCreate'];
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail: unknown = null,
    public retryAfter: string | null = null,
    public fieldErrors: { path: (string | number)[]; message: string; code: string }[] = [],
  ) {
    super(message);
  }
}
export class Client {
  constructor(
    private researcherToken: string,
    private sessionToken = '',
    private onUnauthorized?: () => void,
  ) {}
  setResearcherToken(token: string) {
    this.researcherToken = token;
  }
  async request<T>(
    path: string,
    options: RequestInit = {},
    credential: 'researcher' | 'session' = 'researcher',
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization:
            'Bearer ' + (credential === 'researcher' ? this.researcherToken : this.sessionToken),
          ...options.headers,
        },
      });
    } catch {
      throw new ApiError(0, 'Cannot reach the laboratory server. Retry the read.');
    }
    if (!response.ok) {
      if (response.status === 401 && credential === 'researcher') this.onUnauthorized?.();
      const body = await response.json().catch(() => ({}));
      const fields = Array.isArray(body.detail)
        ? body.detail.map(
            (e: {
              loc?: (string | number)[];
              path?: (string | number)[];
              msg?: string;
              message?: string;
              type?: string;
              code?: string;
            }) => ({
              path: (e.loc ?? e.path ?? []).filter(
                (x) =>
                  x !== 'body' &&
                  !(
                    typeof x === 'string' &&
                    /^(DraftFlowV2|StudyForm|HedonicConfiguration|tagged-union.*)$/.test(x)
                  ),
              ),
              message: e.msg ?? e.message ?? 'Invalid value',
              code: e.type ?? e.code ?? 'validation',
            }),
          )
        : [];
      throw new ApiError(
        response.status,
        response.status === 401
          ? credential === 'researcher'
            ? 'Sign in with your researcher access key.'
            : 'This credential does not authorise the assigned session. Contact the operator.'
          : response.status === 404
            ? 'Resource not found.'
            : typeof body.detail === 'string'
              ? body.detail
              : fields.map((f: { message: string }) => f.message).join('; ') || 'Request failed.',
        body.detail,
        response.headers.get('Retry-After'),
        fields,
      );
    }
    if (response.status === 204) return undefined as T;
    if (
      response.headers.get('Content-Type')?.includes('text/csv') ||
      response.headers.get('Content-Type')?.includes('image/png') ||
      response.headers.get('Content-Type')?.includes('application/zip') ||
      response.headers.get('Content-Type')?.includes('openxmlformats')
    )
      return (await response.blob()) as T;
    return response.json();
  }
  methods(signal?: AbortSignal) {
    return this.request<Method[]>('/test-types', { signal });
  }
  method(id: string, signal?: AbortSignal) {
    return this.request<Method>('/test-types/' + id, { signal });
  }
  studies(
    search: string,
    offset: number,
    signal?: AbortSignal,
    archived: 'exclude' | 'only' = 'exclude',
  ) {
    return this.request<Study[]>(
      '/studies?' + new URLSearchParams({ search, offset: String(offset), limit: '50', archived }),
      { signal },
    );
  }
  /** Close or reopen a study; archive or restore it. Nothing is deleted. */
  studyAction(
    id: string,
    action: 'close' | 'reopen' | 'archive' | 'restore',
    body?: components['schemas']['StudyClose'],
  ) {
    return this.request<Study>('/studies/' + id + '/' + action, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  /** Staff end an assessment that is still in progress. */
  endSession(sessionId: string) {
    return this.request<components['schemas']['SessionRead']>('/sessions/' + sessionId + '/end', {
      method: 'POST',
    });
  }
  study(id: string, signal?: AbortSignal) {
    return this.request<Study>('/studies/' + id, { signal });
  }
  create(body: Create) {
    return this.request<Study>('/studies', { method: 'POST', body: JSON.stringify(body) });
  }
  createFromSamples(body: components['schemas']['StudyFromSamples']) {
    return this.request<Study>('/studies/from-samples', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  version(s: string, v: string, signal?: AbortSignal) {
    return this.request<Version>('/studies/' + s + '/versions/' + v, { signal });
  }
  tests(s: string, v: string, signal?: AbortSignal) {
    return this.request<Test[]>('/studies/' + s + '/versions/' + v + '/tests', { signal });
  }
  assets(s: string, v: string, signal?: AbortSignal) {
    return this.request<components['schemas']['AssetRead'][]>(
      '/studies/' + s + '/versions/' + v + '/assets',
      { signal },
    );
  }
  uploadAsset(s: string, v: string, body: components['schemas']['AssetUpload']) {
    return this.request<components['schemas']['AssetRead']>(
      '/studies/' + s + '/versions/' + v + '/assets',
      { method: 'POST', body: JSON.stringify(body) },
    );
  }
  assetBytes(s: string, v: string, id: string) {
    return this.request<Blob>('/studies/' + s + '/versions/' + v + '/assets/' + id + '/content');
  }
  samples(s: string, v: string, signal?: AbortSignal) {
    return this.request<components['schemas']['SampleRead'][]>(
      '/studies/' + s + '/versions/' + v + '/samples',
      { signal },
    );
  }
  createSample(s: string, body: components['schemas']['SampleCreate']) {
    return this.request<components['schemas']['SampleRead']>('/studies/' + s + '/samples', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  updateSample(s: string, v: string, id: string, body: components['schemas']['SampleUpdate']) {
    return this.request<components['schemas']['SampleRead']>(
      '/studies/' + s + '/versions/' + v + '/samples/' + id,
      { method: 'PUT', body: JSON.stringify(body) },
    );
  }
  deleteSample(s: string, v: string, id: string, revision_hash: string) {
    return this.request<void>(
      '/studies/' +
        s +
        '/versions/' +
        v +
        '/samples/' +
        id +
        '?' +
        new URLSearchParams({ revision_hash }),
      { method: 'DELETE' },
    );
  }
  designs(s: string, v: string) {
    return this.request<components['schemas']['DesignRead'][]>(
      '/studies/' + s + '/versions/' + v + '/designs',
    );
  }
  generateDesign(s: string, v: string, body: components['schemas']['DesignGenerate']) {
    return this.request<components['schemas']['DesignRead']>(
      '/studies/' + s + '/versions/' + v + '/designs',
      { method: 'POST', body: JSON.stringify(body) },
    );
  }
  deleteDesign(s: string, v: string, id: string, revision_hash: string) {
    return this.request<void>(
      '/studies/' +
        s +
        '/versions/' +
        v +
        '/designs/' +
        id +
        '?' +
        new URLSearchParams({ revision_hash }),
      { method: 'DELETE' },
    );
  }
  allocations(s: string, v: string, offset = 0) {
    return this.request<components['schemas']['AllocationRead'][]>(
      '/studies/' +
        s +
        '/versions/' +
        v +
        '/design-allocations?' +
        new URLSearchParams({ offset: String(offset), limit: '100' }),
    );
  }
  blind(s: string, v: string, body: components['schemas']['BlindingGenerate']) {
    return this.request<components['schemas']['SampleRead'][]>(
      '/studies/' + s + '/versions/' + v + '/blinding',
      { method: 'POST', body: JSON.stringify(body) },
    );
  }
  saveTest(s: string, body: SaveTest, id?: string) {
    return this.request<Test>('/studies/' + s + '/tests' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    });
  }
  deleteTest(s: string, id: string, revision_hash: string) {
    return this.request<void>(
      '/studies/' + s + '/tests/' + id + '?' + new URLSearchParams({ revision_hash }),
      { method: 'DELETE' },
    );
  }
  createDraft(s: string, convert_legacy_flow = false) {
    const body: components['schemas']['DraftCreate'] = { convert_legacy_flow };
    return this.request<Version>('/studies/' + s + '/drafts', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  saveFlow(s: string, v: string, body: SaveForm) {
    return this.request<Version>('/studies/' + s + '/versions/' + v + '/form', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }
  saveDetails(s: string, v: string, body: components['schemas']['VersionUpdate']) {
    return this.request<Version>('/studies/' + s + '/versions/' + v, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }
  report(s: string, v: string) {
    return this.request<Report>('/studies/' + s + '/versions/' + v + '/validation');
  }
  saveDraft(s: string, v: string, body: components['schemas']['DraftSave']) {
    return this.request<Version>('/studies/' + s + '/versions/' + v + '/draft', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }
  templates(offset = 0) {
    return this.request<components['schemas']['TemplateRead'][]>(
      '/study-templates?' + new URLSearchParams({ offset: String(offset), limit: '50' }),
    );
  }
  registerTemplate(body: components['schemas']['TemplateCreate']) {
    return this.request<components['schemas']['TemplateRead']>('/study-templates', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  questionnaireItems(includeArchived = false) {
    return this.request<components['schemas']['QuestionnaireItemRead'][]>(
      '/questionnaire-items?' +
        new URLSearchParams({ include_archived: String(includeArchived), limit: '200' }),
    );
  }
  saveQuestionnaireItem(body: components['schemas']['QuestionnaireItemCreate']) {
    return this.request<components['schemas']['QuestionnaireItemRead']>('/questionnaire-items', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  archiveQuestionnaireItem(id: string) {
    return this.request<components['schemas']['QuestionnaireItemRead']>(
      '/questionnaire-items/' + id + '/archive',
      { method: 'POST' },
    );
  }
  templateForm(id: string) {
    return this.request<Flow>('/study-templates/' + id + '/form');
  }
  duplicate(body: components['schemas']['StudyDuplicate']) {
    return this.request<Study>('/studies/duplicate', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  audit(s: string, v: string) {
    return this.request<components['schemas']['DraftAuditRead'][]>(
      '/studies/' + s + '/versions/' + v + '/audit',
    );
  }
  publish(s: string, body: components['schemas']['PublishRequest']) {
    return this.request<Version>('/studies/' + s + '/publish', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  sessions(s: string, v: string, status: string, offset: number) {
    return this.request<components['schemas']['SessionRead'][]>(
      '/studies/' +
        s +
        '/versions/' +
        v +
        '/sessions?' +
        new URLSearchParams({ ...(status ? { status } : {}), offset: String(offset), limit: '50' }),
    );
  }
  provision(body: components['schemas']['SessionCreate']) {
    return this.request<components['schemas']['SessionProvisioned']>('/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  data(s: string, v: string, offset: number) {
    return this.request<components['schemas']['DataRowRead'][]>(
      '/studies/' +
        s +
        '/data?' +
        new URLSearchParams({
          ...(v ? { study_version_id: v } : {}),
          limit: '100',
          offset: String(offset),
        }),
    );
  }
  exportDictionary(s: string, v: string, history: 'all' | 'current') {
    return this.request<components['schemas']['ExportDictionaryRead']>(
      '/studies/' +
        s +
        '/export/dictionary?' +
        new URLSearchParams({ ...(v ? { study_version_id: v } : {}), history }),
    );
  }
  exportData(
    s: string,
    v: string,
    options: components['schemas']['ExportOptions'] = { format: 'long', history: 'all' },
  ) {
    return this.request<Blob>(
      '/studies/' +
        s +
        '/export?' +
        new URLSearchParams({
          ...(v ? { study_version_id: v } : {}),
          format: options.format ?? 'long',
          history: options.history ?? 'all',
        }),
    );
  }
  snapshots(s: string, offset = 0) {
    return this.request<components['schemas']['SnapshotRead'][]>(
      '/studies/' +
        s +
        '/snapshots?' +
        new URLSearchParams({ limit: '50', offset: String(offset) }),
    );
  }
  createSnapshot(s: string, payload: components['schemas']['SnapshotCreate']) {
    return this.request<components['schemas']['SnapshotRead']>('/studies/' + s + '/snapshots', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
  snapshotExport(s: string, id: string, format: 'long' | 'wide' | 'archive') {
    return this.request<Blob>('/studies/' + s + '/snapshots/' + id + '/export?format=' + format);
  }
  snapshotJobs(s: string, id: string, offset = 0) {
    return this.request<components['schemas']['JobRead'][]>(
      '/studies/' +
        s +
        '/snapshots/' +
        id +
        '/jobs?' +
        new URLSearchParams({ limit: '50', offset: String(offset) }),
    );
  }
  queueAnalysis(s: string, id: string, staff: string) {
    return this.request<components['schemas']['JobRead']>(
      '/studies/' + s + '/snapshots/' + id + '/jobs',
      {
        method: 'POST',
        body: JSON.stringify({ staff_name: staff, recipe: 'ledger-state-census-v1' }),
      },
    );
  }
  cancelAnalysis(s: string, id: string, job: string, staff: string) {
    return this.request<components['schemas']['JobRead']>(
      '/studies/' + s + '/snapshots/' + id + '/jobs/' + job + '/cancel',
      { method: 'POST', body: JSON.stringify({ staff_name: staff }) },
    );
  }
  /** Analysis add-on. */
  analysisStatus() {
    return this.request<components['schemas']['AddOnStatusRead']>('/analysis/status');
  }
  suggestedAnalyses(s: string, v: string) {
    return this.request<components['schemas']['SuggestionRead'][]>(
      '/studies/' + s + '/versions/' + v + '/analyses/suggested',
    );
  }
  analyses(s: string) {
    return this.request<components['schemas']['AnalysisRead'][]>('/studies/' + s + '/analyses');
  }
  analysis(s: string, id: string) {
    return this.request<components['schemas']['AnalysisRead']>('/studies/' + s + '/analyses/' + id);
  }
  runAnalysis(s: string, body: components['schemas']['AnalysisCreate']) {
    return this.request<components['schemas']['AnalysisRead']>('/studies/' + s + '/analyses', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  analysisReport(s: string, id: string, format: 'xlsx' | 'docx') {
    return this.request<Blob>('/studies/' + s + '/analyses/' + id + '/report?format=' + format);
  }
  analysisFigure(s: string, id: string, name: string) {
    return this.request<Blob>(
      '/studies/' + s + '/analyses/' + id + '/figures/' + encodeURIComponent(name),
    );
  }
  power(body: components['schemas']['PowerRequest']) {
    return this.request<components['schemas']['PowerRead']>('/analysis/power', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
}
