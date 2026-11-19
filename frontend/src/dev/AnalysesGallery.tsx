import { useState } from 'react';
import { Tabs } from '../ui';
import {
  AddOnNotice,
  AnalysisResult,
  AnalysisSettings,
  AnalysisTable,
  PowerCalculator,
  SuggestionTable,
  type Analysis,
  type Suggestion,
} from '../researcher/Analyses';
import type { components } from '../api-schema';

const base: Omit<Analysis, 'recipe' | 'recipe_title' | 'result' | 'presentation'> = {
  id: 'analysis-fixture-0001',
  study_id: 'fixture-study',
  study_version_id: 'published-v1',
  snapshot_id: 'snapshot-0',
  snapshot_label: 'For analysis 2026-11-18 10:15 UTC',
  snapshot_created_at: '2026-11-18T10:15:00Z',
  study_test_id: 'test-1',
  test_name: 'Nine-point hedonic',
  recipe_version: 1,
  recipe_sha256: 'b'.repeat(64),
  parameters: { alpha: 0.05, comparison: 'tukey' },
  status: 'succeeded',
  staff_name: 'Scientist',
  created_at: '2026-11-18T10:15:00Z',
  started_at: '2026-11-18T10:15:01Z',
  finished_at: '2026-11-18T10:15:03Z',
  error: null,
  runtime: { versions: { R: '4.6.2' } },
  result_sha256: 'c'.repeat(64),
  figures: [],
};
const common = { version: 1, rows_used: 72, rows_left_out: { skipped: 2 }, warnings: [] };
const how = ['Fixture explanation of what the test asks and how p is read.'];

const liking: Analysis = {
  ...base,
  recipe: 'liking-anova',
  recipe_title: 'Compare liking between samples',
  result: {
    ...common,
    recipe: 'liking-anova',
    alpha: 0.05,
    comparison: 'tukey',
    questions: [
      {
        question_id: 'overall',
        question: 'Overall liking',
        n_assessors: 24,
        n_ratings: 72,
        test_name: 'ANOVA with Tukey HSD',
        statistic: 9.81,
        p_value: 0.0003,
        lsd: null,
        samples: [
          { code: '731', n: 24, mean: 7.1, sd: 1.2, ci_low: 6.6, ci_high: 7.6, group: 'a' },
          { code: '159', n: 24, mean: 6.4, sd: 1.4, ci_low: 5.8, ci_high: 7.0, group: 'ab' },
          { code: '482', n: 24, mean: 5.6, sd: 1.6, ci_low: 4.9, ci_high: 6.3, group: 'b' },
        ],
        pairs: [],
        table: [
          { term: 'Sample', df: 2, sum_sq: 27.1, mean_sq: 13.6, statistic: 9.81, p_value: 0.0003 },
          { term: 'Assessor', df: 23, sum_sq: 61.0, mean_sq: 2.65, statistic: 1.9, p_value: 0.03 },
          { term: 'Residual', df: 46, sum_sq: 63.7, mean_sq: 1.38, statistic: null, p_value: null },
        ],
      },
    ],
  },
  presentation: {
    answer: [
      'Liking differed between the samples (p < 0.001, 24 assessors). 731 was liked most (mean 7.1), clearly more than 482.',
      'Samples that share a letter did not differ clearly.',
    ],
    warnings: ['Left out: 2 skipped.'],
    how_to_read: how,
  },
};

const triangle: Analysis = {
  ...base,
  id: 'analysis-fixture-0002',
  test_name: 'Triangle test',
  recipe: 'discrimination',
  recipe_title: 'Can assessors tell the samples apart?',
  parameters: { alpha: 0.05, purpose: 'difference', pd_limit: 0.3 },
  result: {
    ...common,
    rows_used: 36,
    rows_left_out: {},
    recipe: 'discrimination',
    method: 'triangle',
    task: 'difference',
    alpha: 0.05,
    n: 36,
    correct: 21,
    guessing: 1 / 3,
    p_value: 0.0021,
    pc: { estimate: 0.583, low: 0.41, high: 0.74 },
    pd: { estimate: 0.375, low: 0.12, high: 0.61 },
    d_prime: { estimate: 1.62, low: 0.86, high: 2.3 },
    pd_limit: null,
    counts: null,
    conclusion: 'different',
  },
  presentation: {
    answer: [
      'Assessors told the samples apart: 21 of 36 correct in the triangle test (p = 0.002, d′ = 1.62).',
      'About 38 % of assessors could discriminate.',
    ],
    warnings: [],
    how_to_read: how,
  },
};

const jar: Analysis = {
  ...base,
  id: 'analysis-fixture-0003',
  test_name: 'JAR',
  recipe: 'jar-penalty',
  recipe_title: 'Which attributes cost liking? (penalty analysis)',
  result: {
    ...common,
    recipe: 'jar-penalty',
    threshold: 0.2,
    alpha: 0.05,
    liking_question: 'Overall liking',
    attributes: ['Sweetness', 'Saltiness', 'Thickness'].map((name, i) => ({
      question_id: 'q' + i,
      question: name,
      samples: ['731', '482'].map((code, j) => ({
        code,
        n: 24,
        too_little: 0.1 + 0.1 * i,
        just_right: 0.6 - 0.1 * i,
        too_much: 0.3 - 0.05 * j,
        liking_just_right: 7.2,
        drop_too_little: 0.4 + i * 0.6,
        drop_too_much: 1.8 - j * 0.5,
        penalty_too_little: (0.4 + i * 0.6) * (0.1 + 0.1 * i),
        penalty_too_much: (1.8 - j * 0.5) * (0.3 - 0.05 * j),
        p_too_little: 0.2,
        p_too_much: 0.01,
      })),
    })),
  },
  presentation: {
    answer: [
      '731: “Sweetness” was too much for 30 % of assessors, and they liked it 1.8 points less.',
    ],
    warnings: [],
    how_to_read: how,
  },
};

const cata: Analysis = {
  ...base,
  id: 'analysis-fixture-0004',
  test_name: 'CATA',
  recipe: 'cata',
  recipe_title: 'Which attributes describe each sample?',
  result: {
    ...common,
    recipe: 'cata',
    alpha: 0.05,
    n_assessors: 30,
    samples: ['731', '482', '159'],
    liking_question: 'Overall liking',
    attributes: ['Sweet', 'Bitter', 'Creamy', 'Fruity'].map((name, i) => ({
      question_id: 'a' + i,
      question: name,
      counts: { '731': 20 - i * 3, '482': 8 + i, '159': 12 },
      proportions: { '731': (20 - i * 3) / 30, '482': (8 + i) / 30, '159': 0.4 },
      statistic: 10 - i * 2,
      p_value: [0.002, 0.03, 0.2, 0.5][i],
      groups: { '731': 'a', '482': 'b', '159': 'ab' },
      liking_checked: 7 - i * 0.4,
      liking_unchecked: 6,
      impact: 1 - i * 0.4,
      impact_p: 0.04,
    })),
    map: {
      inertia: [71, 29],
      samples: [
        { label: '731', x: 0.4, y: 0.1 },
        { label: '482', x: -0.35, y: 0.2 },
        { label: '159', x: -0.05, y: -0.3 },
      ],
      attributes: [
        { label: 'Sweet', x: 0.5, y: 0.05 },
        { label: 'Bitter', x: -0.45, y: 0.3 },
        { label: 'Creamy', x: 0.1, y: -0.4 },
        { label: 'Fruity', x: -0.1, y: 0.1 },
      ],
    },
  },
  presentation: {
    answer: ['2 of 4 attributes were checked differently between the samples (30 assessors).'],
    warnings: [],
    how_to_read: how,
  },
};

const rataAttributes = ['Sweet', 'Bitter', 'Creamy', 'Fruity'];
const rata: Analysis = {
  ...base,
  id: 'analysis-fixture-0007',
  test_name: 'RATA',
  recipe: 'rata',
  recipe_title: 'How strongly does each sample show each attribute?',
  result: {
    ...common,
    recipe: 'rata',
    alpha: 0.05,
    comparison: 'tukey',
    rating_target: 'intensity',
    rating_min: 1,
    n_assessors: 30,
    samples: ['731', '482', '159'],
    attributes: rataAttributes.map((name, i) => ({
      question_id: 'r' + i,
      question: name,
      n_assessors: 30,
      statistic: 14 - i * 4,
      p_value: [0.0001, 0.004, 0.09, 0.6][i],
      samples: [
        { code: '731', n: 30, mean: 3.9 - i * 0.6, sd: 1.2, checked: 0.9 - i * 0.1, group: 'a' },
        { code: '482', n: 30, mean: 1.4 + i * 0.3, sd: 1.4, checked: 0.4 + i * 0.05, group: 'b' },
        { code: '159', n: 30, mean: 2.6, sd: 1.3, checked: 0.6, group: i < 2 ? 'ab' : 'a' },
      ],
    })),
    map: {
      inertia: [83, 17],
      samples: [
        { label: '731', x: 1.6, y: 0.2 },
        { label: '482', x: -1.4, y: 0.3 },
        { label: '159', x: -0.2, y: -0.5 },
      ],
      attributes: [
        { label: 'Sweet', x: 1.2, y: 0.1 },
        { label: 'Bitter', x: -0.9, y: 0.4 },
        { label: 'Creamy', x: 0.5, y: -0.6 },
        { label: 'Fruity', x: -0.2, y: 0.1 },
      ],
    },
  },
  presentation: {
    answer: [
      '2 of 4 attributes were rated differently between the samples (30 assessors).',
      '“Sweet” was strongest in 731 (mean 3.9) and weakest in 482 (1.4; p < 0.001).',
    ],
    warnings: [],
    how_to_read: how,
  },
};

const running: Analysis = {
  ...liking,
  id: 'analysis-fixture-0005',
  status: 'running',
  result: null,
  presentation: null,
  finished_at: null,
  result_sha256: null,
};
const failed: Analysis = {
  ...running,
  id: 'analysis-fixture-0006',
  status: 'failed',
  error: 'The analysis took longer than 120 seconds.',
};

const suggestions: Suggestion[] = [
  {
    recipe: 'liking-anova',
    recipe_title: 'Compare liking between samples',
    study_test_id: 'test-1',
    test_name: 'Nine-point hedonic',
    test_type_id: 'hedonic-9-v1',
    samples: 3,
    assessors: 24,
    settings: { alpha: 0.05, comparison: 'tukey' },
    liking_tests: [],
    needs_liking: false,
  },
  {
    recipe: 'jar-penalty',
    recipe_title: 'Which attributes cost liking? (penalty analysis)',
    study_test_id: 'test-2',
    test_name: 'JAR',
    test_type_id: 'jar-v1',
    samples: 3,
    assessors: 24,
    settings: { alpha: 0.05, threshold: 0.2, liking_test_id: 'test-1', liking_question_id: null },
    liking_tests: [
      {
        study_test_id: 'test-1',
        name: 'Nine-point hedonic',
        questions: [{ id: 'overall', text: 'Overall liking' }],
      },
    ],
    needs_liking: true,
  },
];

export function AnalysesGallery() {
  const [state, setState] = useState('liking');
  const [settings, setSettings] = useState<Record<string, unknown>>(suggestions[1].settings);
  const [staff, setStaff] = useState('Scientist');
  const [power, setPower] = useState<components['schemas']['PowerRequest']>({
    method: 'triangle',
    purpose: 'difference',
    effect: 'pd',
    size: 0.3,
    alpha: 0.05,
    target_power: 0.8,
  });
  const views: Record<string, [string, React.ReactNode]> = {
    liking: ['Liking result', <AnalysisResult analysis={liking} onDownload={() => {}} />],
    triangle: ['Triangle result', <AnalysisResult analysis={triangle} onDownload={() => {}} />],
    jar: ['Penalty result', <AnalysisResult analysis={jar} onDownload={() => {}} />],
    cata: ['CATA result', <AnalysisResult analysis={cata} onDownload={() => {}} />],
    rata: ['RATA result', <AnalysisResult analysis={rata} onDownload={() => {}} />],
    running: ['Running', <AnalysisResult analysis={running} />],
    failed: ['Failed', <AnalysisResult analysis={failed} />],
    setup: [
      'Settings',
      <AnalysisSettings
        suggestion={suggestions[1]}
        settings={settings}
        staff={staff}
        ready
        busy={false}
        onChange={setSettings}
        onStaff={setStaff}
        onRun={() => {}}
      />,
    ],
    missing: [
      'Add-on missing',
      <AddOnNotice
        status={{ state: 'missing', message: 'The analysis add-on is not installed.' }}
      />,
    ],
    lists: [
      'Lists',
      <div className="ui-stack">
        <SuggestionTable rows={suggestions} onSelect={() => {}} />
        <AnalysisTable
          rows={[liking, triangle, jar, cata, rata, running, failed]}
          onOpen={() => {}}
        />
      </div>,
    ],
    power: [
      'Assessors needed',
      <PowerCalculator
        value={power}
        result={{
          method: 'triangle',
          purpose: 'difference',
          alpha: 0.05,
          pd: 0.3,
          d_prime: 1.64,
          pc: 0.533,
          target_power: 0.8,
          assessors: 42,
          critical_correct: 20,
          power: 0.81,
          reachable: true,
        }}
        error=""
        busy={false}
        onChange={setPower}
        onCalculate={() => {}}
      />,
    ],
  };
  return (
    <section
      id="analyses-gallery"
      className="ui-gallery-section ui-stack"
      aria-label="Analysis fixtures"
    >
      <Tabs
        label="Analysis states"
        value={state}
        onChange={setState}
        tabs={Object.entries(views).map(([id, [label, content]]) => ({ id, label, content }))}
      />
    </section>
  );
}
