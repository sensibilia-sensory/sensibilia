import type { Flow, Sample, Test } from '../shared/flow';
const id = (n: number) => '50000000-0000-4000-8000-' + String(n).padStart(12, '0');
export const runSamples: Sample[] = Array.from({ length: 4 }, (_, i) => ({
  id: id(20 + i),
  study_version_id: id(30),
  code: 'S' + i,
  label: 'Private ' + i,
  ingredient_tags: i === 1 ? ['nut'] : [],
}));
export const runTests: Test[] = [
  {
    id: id(40),
    study_version_id: id(30),
    test_type_id: 'hedonic-9-v1',
    position: 0,
    configuration: {
      instructions: 'Researcher rating instructions',
      questions: [{ id: 'liking', prompt: 'Overall liking', required: true }],
      allow_skips: false,
      scale_labels: [
        'Dislike extremely',
        'Dislike very much',
        'Dislike moderately',
        'Dislike slightly',
        'Neither like nor dislike',
        'Like slightly',
        'Like moderately',
        'Like very much',
        'Like extremely',
      ],
    },
  },
];
export const runFlow: Flow = {
  schema_version: 2,
  languages: ['en'],
  default_language: 'en',
  restriction_source_id: id(2),
  restriction_tag_map: { nuts: ['nut'] },
  nodes: [
    {
      id: id(1),
      kind: 'code_entry',
      title: { en: 'Returning code' },
      data: {
        prompt: { en: 'Returning participant code' },
        source: 'returning_codes',
        allow_unknown: true,
        normalization: 'trim_upper_ascii',
      },
    },
    {
      id: id(2),
      kind: 'question',
      title: { en: 'Restrictions' },
      data: {
        prompt: { en: 'Restrictions' },
        answer_type: 'multiple',
        required: true,
        allow_skip: false,
        layout: 'vertical',
        options: [
          { id: 'nuts', label: { en: 'Nuts' }, exclusive: false },
          { id: 'none', label: { en: 'None' }, exclusive: true },
        ],
      },
    },
    {
      id: id(3),
      kind: 'question',
      title: { en: 'Baseline' },
      guard: { variable: 'answer.' + id(1) + '.matched', operator: 'eq', value: false },
      data: {
        prompt: { en: 'Age in years' },
        answer_type: 'integer',
        required: true,
        allow_skip: false,
        layout: 'vertical',
        min: 0,
        max: 120,
      },
    },
    {
      id: id(4),
      kind: 'loop_samples',
      title: { en: 'Samples' },
      data: {
        sample_ids: runSamples.map((s) => s.id),
        children: [
          {
            id: id(5),
            kind: 'code_entry',
            title: { en: 'Sample code' },
            data: {
              prompt: { en: 'Confirm sample code' },
              source: 'sample_code',
              allow_unknown: false,
              normalization: 'trim_upper_ascii',
            },
          },
          {
            id: id(6),
            kind: 'info',
            title: { en: 'Warning' },
            guard: {
              variable: 'derived.sample_conflicts_restriction',
              operator: 'eq',
              value: true,
            },
            data: { body: { en: 'Do not taste this sample.' }, continue_label: { en: 'Continue' } },
          },
          {
            id: id(7),
            kind: 'embedded_method',
            title: { en: 'Liking' },
            guard: {
              variable: 'derived.sample_conflicts_restriction',
              operator: 'eq',
              value: false,
            },
            otherwise: { action: 'next_sample' },
            data: { study_test_id: id(40), sample_binding: 'current' },
          },
        ],
      },
    },
    {
      id: id(8),
      kind: 'end',
      title: { en: 'Finish' },
      data: { body: { en: 'Thank you' }, outcome: 'completed' },
    },
  ],
};
