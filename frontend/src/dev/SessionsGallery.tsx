import { useState } from 'react';
import { Tabs } from '../ui';
import { SessionTable, SessionCredential } from '../researcher/Sessions';
import { AssessorView, HandoverReady } from '../assessor/Assessor';
import { assignmentsFor, initialState, type Flow, type Sample } from '../shared/flow';
import type { Package } from '../assessor/storage';
const row = {
  id: '10000000-0000-4000-8000-000000000001',
  study_version_id: '10000000-0000-4000-8000-000000000002',
  assessor_code: 'A01',
  status: 'in_progress',
  started_at: '2026-10-11T12:00:00Z',
  completed_at: null,
  presentation_order: [],
};
const flow: Flow = {
  schema_version: 2,
  languages: ['en'],
  default_language: 'en',
  nodes: [
    {
      id: row.id,
      kind: 'info',
      title: { en: 'Read instructions' },
      data: {
        body: { en: 'Follow the laboratory instructions.' },
        continue_label: { en: 'Continue' },
        asset_ids: [],
      },
      otherwise: { action: 'continue' },
    },
    {
      id: row.study_version_id,
      kind: 'end',
      title: { en: 'Finish' },
      data: { body: { en: 'Thank you.' }, outcome: 'completed' },
      otherwise: { action: 'continue' },
    },
  ],
  method_text: {},
  restriction_tag_map: {},
};
const pkg: Package = {
  package_schema_version: 4,
  flow,
  evaluator_version: 'linear-v2.1',
  context: { language: 'en' },
  loop_assignments: [],
  session: row,
  study_version: {
    id: row.study_version_id,
    study_id: row.id,
    version_number: 1,
    title: 'Fixture',
    description: '',
    published_at: '2026-10-11',
    revision_hash: 'fixture',
    form: flow,
  },
  test_types: [],
  tests: [],
  samples: [],
  assets: [],
  assignments: [],
};
const loopSamples: Sample[] = ['417', '902', '355'].map((code, i) => ({
  id: '20000000-0000-4000-8000-00000000000' + i,
  study_version_id: row.study_version_id,
  code,
  label: 'Private ' + i,
  ingredient_tags: [],
}));
const loopFlow: Flow = {
  schema_version: 2,
  languages: ['en'],
  default_language: 'en',
  nodes: [
    {
      id: '30000000-0000-4000-8000-000000000001',
      kind: 'loop_samples',
      title: { en: 'Samples' },
      data: {
        sample_ids: loopSamples.map((s) => s.id),
        children: [
          {
            id: '30000000-0000-4000-8000-000000000002',
            kind: 'question',
            title: { en: 'How pleasant is the aroma?' },
            data: {
              prompt: { en: 'Aroma' },
              answer_type: 'single',
              required: true,
              allow_skip: false,
              layout: 'vertical',
              options: [
                { id: 'a', label: { en: 'Not pleasant' }, exclusive: false },
                { id: 'b', label: { en: 'Neither pleasant nor unpleasant' }, exclusive: false },
                { id: 'c', label: { en: 'Pleasant' }, exclusive: false },
              ],
            },
          },
        ],
      },
    },
  ],
  method_text: {},
  restriction_tag_map: {},
};
const loopAssignments = assignmentsFor(loopFlow, loopSamples);
const handover = {
  assessor: 'A01',
  study: 'Fixture',
  version: '1 (released)',
  booth: '4',
  language: 'en',
};
export function SessionsGallery() {
  const [tab, setTab] = useState('list');
  return (
    <section id="sessions" className="ui-gallery-section ui-stack" aria-label="Session fixtures">
      <Tabs
        label="Session fixture states"
        value={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'list',
            label: 'List',
            content: (
              <SessionTable
                rows={Array.from({ length: 20 }, (_, i) => ({
                  ...row,
                  id: row.id.slice(0, -2) + String(i).padStart(2, '0'),
                  assessor_code: 'A' + i,
                }))}
                onRetry={() => {}}
              />
            ),
          },
          { id: 'empty', label: 'Empty', content: <SessionTable rows={[]} onRetry={() => {}} /> },
          {
            id: 'loading',
            label: 'Loading',
            content: <SessionTable rows={[]} loading onRetry={() => {}} />,
          },
          {
            id: 'error',
            label: 'Error',
            content: (
              <SessionTable
                rows={[]}
                error="Cannot reach laboratory server."
                onRetry={() => setTab('list')}
              />
            ),
          },
          {
            id: 'credential',
            label: 'Credential',
            content: (
              <SessionCredential
                session={{ ...row, session_token: 'fixture-token' }}
                onClose={() => setTab('list')}
              />
            ),
          },
          {
            id: 'tablet',
            label: 'Tablet',
            content: (
              <div className="ui-assessor-demo">
                <AssessorView
                  embedded
                  pkg={pkg}
                  state={initialState(flow)}
                  pending={3}
                  onAnswer={() => {}}
                  onNext={() => {}}
                  onSync={() => {}}
                />
              </div>
            ),
          },
          {
            id: 'tablet-sample',
            label: 'Sample question',
            content: (
              <div className="ui-assessor-demo">
                <AssessorView
                  embedded
                  pkg={{ ...pkg, flow: loopFlow, loop_assignments: loopAssignments }}
                  state={initialState(loopFlow, {}, loopAssignments)}
                  answer={{ state: 'answered', value: 'b' }}
                  onAnswer={() => {}}
                  onNext={() => {}}
                  onSync={() => {}}
                />
              </div>
            ),
          },
          {
            id: 'handover',
            label: 'Handover',
            content: (
              <div className="ui-assessor-demo">
                <HandoverReady embedded summary={handover} onConfirm={() => {}} />
              </div>
            ),
          },
          {
            id: 'readonly',
            label: 'Read-only',
            content: (
              <div className="ui-assessor-demo">
                <AssessorView
                  embedded
                  pkg={pkg}
                  state={{ ...initialState(flow), review: { nodeId: row.id, resume: 0 } }}
                  onAnswer={() => {}}
                  onNext={() => {}}
                  onSync={() => {}}
                />
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
