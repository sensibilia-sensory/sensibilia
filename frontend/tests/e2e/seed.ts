import { expect, type APIRequestContext } from '@playwright/test';

export const researcherHeaders = { Authorization: 'Bearer e2e-researcher-' + 'x'.repeat(32) };

const node = (kind: string, data: object, title: string) => ({
  id: crypto.randomUUID(),
  kind,
  title: { en: title },
  data,
  otherwise: { action: 'continue' },
});

/** A small published study (instructions, one hedonic test, end) created through the API. */
export async function publishSmallStudy(request: APIRequestContext, title: string) {
  const headers = researcherHeaders;
  const study = await (await request.post('/studies', { headers, data: { title } })).json();
  const versionId = study.versions[0].id as string;
  const base = '/studies/' + study.id + '/versions/' + versionId;
  const method = await (
    await request.post('/studies/' + study.id + '/tests', {
      headers,
      data: {
        configuration: {
          instructions: 'Taste and rate.',
          questions: [{ id: 'liking', prompt: 'Overall liking', required: true }],
          allow_skips: false,
        },
      },
    })
  ).json();
  const flow = {
    schema_version: 2,
    languages: ['en'],
    default_language: 'en',
    nodes: [
      node(
        'info',
        {
          body: { en: 'Read the laboratory instructions.' },
          continue_label: { en: 'Continue' },
          asset_ids: [],
        },
        'Instructions',
      ),
      node('embedded_method', { study_test_id: method.id, sample_binding: 'none' }, 'Liking'),
      node('end', { body: { en: 'Thank you.' }, outcome: 'completed' }, 'Finish'),
    ],
  };
  const version = await (await request.get(base, { headers })).json();
  expect(
    (
      await request.put(base + '/form', {
        headers,
        data: { form: flow, revision_hash: version.revision_hash },
      })
    ).status(),
  ).toBe(200);
  const review = await (await request.get(base + '/validation', { headers })).json();
  expect(review.valid, JSON.stringify(review.issues)).toBeTruthy();
  expect(
    (
      await request.post('/studies/' + study.id + '/publish', {
        headers,
        data: { study_version_id: versionId, revision_hash: review.revision_hash },
      })
    ).status(),
  ).toBe(200);
  return { studyId: study.id as string, versionId };
}

/** A room with `count` booths; returns the booth ids in order. */
export async function createRoom(request: APIRequestContext, name: string, count: number) {
  const room = await (
    await request.post('/rooms', {
      headers: researcherHeaders,
      data: {
        name,
        rows: 1,
        columns: count,
        booths: Array.from({ length: count }, (_, i) => ({
          id: crypto.randomUUID(),
          label: 'Booth ' + (i + 1),
          row: 1,
          column: i + 1,
          enabled: true,
        })),
      },
    })
  ).json();
  return room.booths.map((b: { id: string }) => b.id) as string[];
}

/** Issue a pairing code through the API (a staff action) and return it. */
export async function issuePairing(request: APIRequestContext, boothId?: string) {
  const issued = await (
    await request.post('/terminals/pairings', {
      headers: researcherHeaders,
      data: { staff_name: 'Seed staff', booth_id: boothId ?? null },
    })
  ).json();
  return issued.code as string;
}

/** A published study whose first step is a Wait for sample item for one sample (code 731). */
export async function publishServingStudy(request: APIRequestContext, title: string) {
  const headers = researcherHeaders;
  const study = await (await request.post('/studies', { headers, data: { title } })).json();
  const versionId = study.versions[0].id as string;
  const base = '/studies/' + study.id + '/versions/' + versionId;
  const method = await (
    await request.post('/studies/' + study.id + '/tests', {
      headers,
      data: {
        configuration: {
          instructions: 'Taste and rate.',
          questions: [{ id: 'liking', prompt: 'Overall liking', required: true }],
          allow_skips: false,
        },
      },
    })
  ).json();
  const sample = await (
    await request.post('/studies/' + study.id + '/samples', {
      headers,
      data: { code: '731', label: 'Private batch', ingredient_tags: [] },
    })
  ).json();
  const gateId = crypto.randomUUID();
  const flow = {
    schema_version: 2,
    languages: ['en'],
    default_language: 'en',
    nodes: [
      {
        id: gateId,
        kind: 'serve_gate',
        title: { en: 'Delivery' },
        data: {
          body: { en: 'Wait for your sample.' },
          preparation: { en: 'One portion' },
          sample_binding: 'set',
          sample_ids: [sample.id],
        },
        otherwise: { action: 'continue' },
      },
      node('embedded_method', { study_test_id: method.id, sample_binding: 'none' }, 'Liking'),
      node('end', { body: { en: 'Thank you.' }, outcome: 'completed' }, 'Finish'),
    ],
  };
  const version = await (await request.get(base, { headers })).json();
  expect(
    (
      await request.put(base + '/form', {
        headers,
        data: { form: flow, revision_hash: version.revision_hash },
      })
    ).status(),
  ).toBe(200);
  const review = await (await request.get(base + '/validation', { headers })).json();
  expect(review.valid, JSON.stringify(review.issues)).toBeTruthy();
  expect(
    (
      await request.post('/studies/' + study.id + '/publish', {
        headers,
        data: { study_version_id: versionId, revision_hash: review.revision_hash },
      })
    ).status(),
  ).toBe(200);
  return { studyId: study.id as string, versionId, gateId };
}
