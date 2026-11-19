import type { components } from './api-schema';

export type Study = Omit<components['schemas']['StudyRead'], 'versions'> & { versions: Version[] };
// Retained legacy editor handles Form v1 only; the active client uses VersionRead directly.
export type Version = Omit<components['schemas']['VersionRead'], 'form'> & {
  form?: StudyForm | null;
};
export type StudyTest = Omit<components['schemas']['TestRead'], 'configuration'> & {
  configuration: MethodConfiguration;
};
export type Method = components['schemas']['TestTypeRead'];
export type Configuration = components['schemas']['HedonicConfiguration'];
type WithKind<T extends { kind?: string; sample_ids?: string[] }> = T & {
  kind: NonNullable<T['kind']>;
  sample_ids: string[];
};
export type NewConfiguration =
  | WithKind<components['schemas']['CATAConfiguration']>
  | WithKind<components['schemas']['RATAConfiguration']>
  | WithKind<components['schemas']['JARConfiguration']>
  | WithKind<components['schemas']['TriangleConfiguration']>
  | WithKind<components['schemas']['DuoTrioConfiguration']>
  | WithKind<components['schemas']['TwoAFCConfiguration']>
  | WithKind<components['schemas']['FlashConfiguration']>
  | WithKind<components['schemas']['NappingConfiguration']>
  | WithKind<components['schemas']['TCATAConfiguration']>;
export type MethodConfiguration = Configuration | NewConfiguration;
export type Sample = components['schemas']['SampleRead'];
export type MethodValue = components['schemas']['EventCreate']['value'];
export type PreviewObservation = {
  sample_id: string | null;
  question_id: string;
  value: MethodValue;
};
export type PublicAssignment = {
  study_test_id?: string;
  kind: string;
  samples: { slot_id: string; code: string; sample_id?: string }[];
  reference: { slot_id: string; code: string } | null;
};
export type Question = Configuration['questions'][number];
export type StudyDetails = components['schemas']['StudyCreate'];
export type StudyForm = components['schemas']['StudyForm'];
export type FormStep = StudyForm['steps'][number];
export type MatrixStep = Extract<FormStep, { kind: 'matrix' }>;
export type ChoiceStep = Extract<FormStep, { kind: 'choice' }>;
export type Route = components['schemas']['Route'];
export type Selection = components['schemas']['SelectionValue'];
export type StepValue =
  | components['schemas']['ContinueValue']
  | components['schemas']['ChoiceValue']
  | components['schemas']['MatrixValue'];

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class Api {
  constructor(private token: string) {}

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
          ...options.headers,
        },
      });
    } catch {
      throw new ApiError(
        0,
        'Cannot reach the laboratory server. Check your connection and try again.',
      );
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail = body.detail;
      const message =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail
                .map(
                  (error: { loc?: (string | number)[]; msg?: string }) =>
                    `${error.loc?.slice(1).join(' → ') || 'Configuration'}: ${error.msg}`,
                )
                .join('. ')
            : 'The request could not be completed. Try again.';
      throw new ApiError(
        response.status,
        response.status === 401
          ? 'The access key was not accepted. Sign in with your laboratory researcher key.'
          : message,
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json();
  }

  methods(signal?: AbortSignal) {
    return this.request<Method[]>('/test-types', { signal });
  }
  studies(search = '', offset = 0, signal?: AbortSignal) {
    return this.request<Study[]>(
      `/studies?${new URLSearchParams({ search, offset: `${offset}`, limit: '50' })}`,
      { signal },
    );
  }
  study(id: string, signal?: AbortSignal) {
    return this.request<Study>(`/studies/${id}`, { signal });
  }
  createStudy(details: StudyDetails) {
    return this.request<Study>('/studies', { method: 'POST', body: JSON.stringify(details) });
  }
  updateStudy(id: string, details: StudyDetails) {
    return this.request<Study>(`/studies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(details),
    });
  }
  tests(id: string, version: string, signal?: AbortSignal) {
    return this.request<StudyTest[]>(`/studies/${id}/versions/${version}/tests`, { signal });
  }
  saveTest(study: string, config: MethodConfiguration, testId?: string, methodId = 'hedonic-9-v1') {
    return this.request<StudyTest>(`/studies/${study}/tests${testId ? `/${testId}` : ''}`, {
      method: testId ? 'PUT' : 'POST',
      body: JSON.stringify({ test_type_id: methodId, configuration: config }),
    });
  }
  deleteTest(study: string, test: string) {
    return this.request<void>(`/studies/${study}/tests/${test}`, { method: 'DELETE' });
  }
  publish(study: string) {
    return this.request<Version>(`/studies/${study}/publish`, { method: 'POST' });
  }
  draft(study: string) {
    return this.request<Version>(`/studies/${study}/drafts`, { method: 'POST' });
  }
  saveForm(study: string, version: string, form: StudyForm | null) {
    return this.request<Version>(`/studies/${study}/versions/${version}/form`, {
      method: 'PUT',
      body: JSON.stringify({ form }),
    });
  }
  samples(study: string, version: string, signal?: AbortSignal) {
    return this.request<Sample[]>(`/studies/${study}/versions/${version}/samples`, { signal });
  }
  addSample(study: string, code: string, label: string) {
    return this.request<Sample>(`/studies/${study}/samples`, {
      method: 'POST',
      body: JSON.stringify({ code, label }),
    });
  }
}
