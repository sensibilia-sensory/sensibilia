import { useEffect, useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { components } from '../api-schema';
import {
  BarChart,
  Button,
  DataTable,
  Field,
  PropertyGrid,
  ScatterChart,
  SidePanel,
  Toolbar,
} from '../ui';
import { analysisWords, statusLabel } from '../shared/lexicon';
import { saveBlob } from './download';
import type { Client, Version } from './client';

export type Analysis = components['schemas']['AnalysisRead'];
export type Suggestion = components['schemas']['SuggestionRead'];
export type AddOnStatus = components['schemas']['AddOnStatusRead'];
type Liking = components['schemas']['LikingResult'];
type Discrimination = components['schemas']['DiscriminationResult'];
type JAR = components['schemas']['JARResult'];
type CATA = components['schemas']['CATAResult'];
type RATA = components['schemas']['RATAResult'];
type PowerRequest = components['schemas']['PowerRequest'];
type PowerRead = components['schemas']['PowerRead'];
type Settings = Record<string, unknown>;

const num = (v: number | null | undefined, digits = 2) => (v == null ? '–' : v.toFixed(digits));
const pct = (v: number | null | undefined) => (v == null ? '–' : Math.round(v * 100) + ' %');
const p = (v: number | null | undefined) =>
  v == null ? '–' : v < 0.001 ? '< 0.001' : v.toFixed(3);
const when = (v: string | null | undefined) => (v ? v.slice(0, 16).replace('T', ' ') : '–');

// --- Tables ---------------------------------------------------------------------------------

const suggestionColumns: ColumnDef<Suggestion>[] = [
  { accessorKey: 'recipe_title', header: 'Analysis' },
  { accessorKey: 'test_name', header: 'Test' },
  { accessorKey: 'samples', header: 'Samples' },
  { accessorKey: 'assessors', header: 'Assessments' },
];

export function SuggestionTable({
  rows,
  selected,
  onSelect,
  loading = false,
}: {
  rows: Suggestion[];
  selected?: Suggestion | null;
  onSelect: (row: Suggestion) => void;
  loading?: boolean;
}) {
  return (
    <DataTable
      id="analysis-suggestions"
      label="Analyses for this version"
      data={rows}
      columns={suggestionColumns}
      getRowId={(r) => r.recipe + ':' + r.study_test_id}
      selectable={false}
      onActivate={onSelect}
      emptyText={loading ? 'Loading…' : 'No analyses apply to the tests in this version yet.'}
      rowActions={(r) => (
        <Button
          compact
          variant={selected === r ? 'primary' : 'default'}
          onClick={() => onSelect(r)}
        >
          Set up
        </Button>
      )}
    />
  );
}

const analysisColumns: ColumnDef<Analysis>[] = [
  { accessorKey: 'recipe_title', header: 'Analysis' },
  { accessorKey: 'test_name', header: 'Test' },
  { id: 'status', header: 'Status', accessorFn: (r) => statusLabel(r.status) },
  { accessorKey: 'snapshot_label', header: 'Data' },
  { accessorKey: 'staff_name', header: 'Ran by' },
  { id: 'finished', header: 'Finished', accessorFn: (r) => when(r.finished_at) },
];

export function AnalysisTable({
  rows,
  onOpen,
  loading = false,
}: {
  rows: Analysis[];
  onOpen: (row: Analysis) => void;
  loading?: boolean;
}) {
  return (
    <DataTable
      id="analysis-runs"
      label="Analyses run"
      data={rows}
      columns={analysisColumns}
      getRowId={(r) => r.id}
      selectable={false}
      onActivate={onOpen}
      emptyText={loading ? 'Loading…' : 'No analyses have been run for this study.'}
      rowActions={(r) => (
        <Button compact onClick={() => onOpen(r)}>
          Open
        </Button>
      )}
    />
  );
}

// --- Settings -------------------------------------------------------------------------------

const alphaOptions = [
  { value: '0.05', label: '5 % (usual)' },
  { value: '0.01', label: '1 % (strict)' },
  { value: '0.1', label: '10 % (lenient)' },
];

export function AnalysisSettings({
  suggestion,
  settings,
  staff,
  ready,
  busy,
  onChange,
  onStaff,
  onRun,
}: {
  suggestion: Suggestion;
  settings: Settings;
  staff: string;
  ready: boolean;
  busy: boolean;
  onChange: (next: Settings) => void;
  onStaff: (value: string) => void;
  onRun: () => void;
}) {
  const set = (key: string, value: unknown) => onChange({ ...settings, [key]: value });
  const liking = suggestion.liking_tests.find((t) => t.study_test_id === settings.liking_test_id);
  return (
    <div className="ui-stack">
      <h3>{suggestion.recipe_title}</h3>
      <p>
        {suggestion.test_name}. Running freezes the answers collected so far; later answers do not
        change this result.
      </p>
      <Field
        label="Significance level"
        kind="select"
        value={String(settings.alpha ?? 0.05)}
        options={alphaOptions}
        onChange={(e) => set('alpha', Number(e.target.value))}
      />
      {suggestion.recipe === 'liking-anova' && (
        <Field
          label="Compare samples with"
          kind="select"
          value={String(settings.comparison)}
          options={['tukey', 'lsd', 'friedman'].map((v) => ({ value: v, label: analysisWords[v] }))}
          onChange={(e) => set('comparison', e.target.value)}
        />
      )}
      {suggestion.recipe === 'rata' && (
        <Field
          label="Compare samples with"
          kind="select"
          value={String(settings.comparison)}
          options={['tukey', 'lsd'].map((v) => ({ value: v, label: analysisWords[v] }))}
          onChange={(e) => set('comparison', e.target.value)}
        />
      )}
      {suggestion.recipe === 'discrimination' && (
        <>
          <Field
            label="Question"
            kind="select"
            value={String(settings.purpose)}
            options={['difference', 'similarity'].map((v) => ({
              value: v,
              label: analysisWords[v],
            }))}
            onChange={(e) => set('purpose', e.target.value)}
            hint="A 2-AFC preference test is always analysed as a preference."
          />
          {settings.purpose === 'similarity' && (
            <Field
              label="Similar if at most"
              kind="select"
              value={String(settings.pd_limit)}
              options={[0.1, 0.2, 0.3, 0.4, 0.5].map((v) => ({
                value: String(v),
                label: Math.round(v * 100) + ' % of assessors can tell them apart',
              }))}
              onChange={(e) => set('pd_limit', Number(e.target.value))}
            />
          )}
        </>
      )}
      {suggestion.recipe === 'jar-penalty' && (
        <Field
          label="Flag when off for at least"
          kind="select"
          value={String(settings.threshold)}
          options={[0.1, 0.15, 0.2, 0.25, 0.3].map((v) => ({
            value: String(v),
            label: Math.round(v * 100) + ' % of assessors' + (v === 0.2 ? ' (usual)' : ''),
          }))}
          onChange={(e) => set('threshold', Number(e.target.value))}
        />
      )}
      {(suggestion.recipe === 'jar-penalty' || suggestion.recipe === 'cata') && (
        <>
          <Field
            label="Liking from"
            kind="select"
            value={String(settings.liking_test_id ?? '')}
            options={[
              ...(suggestion.recipe === 'cata' ? [{ value: '', label: 'No liking' }] : []),
              ...suggestion.liking_tests.map((t) => ({ value: t.study_test_id, label: t.name })),
            ]}
            onChange={(e) =>
              onChange({
                ...settings,
                liking_test_id: e.target.value || null,
                liking_question_id: null,
              })
            }
          />
          {liking && liking.questions.length > 1 && (
            <Field
              label="Liking question"
              kind="select"
              value={String(settings.liking_question_id ?? liking.questions[0].id)}
              options={liking.questions.map((q) => ({ value: q.id, label: q.text }))}
              onChange={(e) => set('liking_question_id', e.target.value)}
            />
          )}
        </>
      )}
      <Field label="Your name" value={staff} onChange={(e) => onStaff(e.target.value)} />
      <Toolbar label="Run this analysis">
        <Button variant="primary" disabled={!ready || busy || !staff.trim()} onClick={onRun}>
          Run analysis
        </Button>
      </Toolbar>
    </div>
  );
}

// --- Results --------------------------------------------------------------------------------

function LikingView({ result }: { result: Liking }) {
  return (
    <>
      {result.questions.map((q) => (
        <div key={q.question_id} className="ui-stack">
          {result.questions.length > 1 && <h4>{q.question}</h4>}
          <BarChart
            title={'Mean liking: ' + (q.question ?? '')}
            items={q.samples.map((s) => ({
              label: s.code,
              value: s.mean,
              low: s.ci_low,
              high: s.ci_high,
              note: s.group,
            }))}
            min={1}
            max={9}
            axisLabel="Mean liking (1–9)"
          />
          <DataTable
            id={'liking-' + q.question_id}
            label={'Liking means ' + (q.question ?? '')}
            data={q.samples}
            getRowId={(r) => r.code}
            selectable={false}
            columns={[
              { accessorKey: 'code', header: 'Sample' },
              { accessorKey: 'n', header: 'Ratings' },
              { id: 'mean', header: 'Mean', accessorFn: (r) => num(r.mean) },
              {
                id: 'ci',
                header: '95 % CI',
                accessorFn: (r) => num(r.ci_low) + '–' + num(r.ci_high),
              },
              { id: 'group', header: 'Group', accessorFn: (r) => r.group ?? '–' },
            ]}
          />
        </div>
      ))}
    </>
  );
}

function DiscriminationView({ result }: { result: Discrimination }) {
  if (result.task === 'preference') {
    const counts = Object.entries(result.counts ?? {});
    return (
      <BarChart
        title="Choices"
        items={counts.map(([code, count]) => ({ label: code, value: count }))}
        min={0}
        max={Math.max(result.n, 1)}
        axisLabel="Assessors"
        reference={{ value: result.n / 2, label: 'No preference' }}
      />
    );
  }
  const rows = [
    ['Correct', `${result.correct} of ${result.n}`],
    ['p', p(result.p_value)],
    [
      'Proportion of discriminators',
      pct(result.pd?.estimate) + ` (${pct(result.pd?.low)}–${pct(result.pd?.high)})`,
    ],
    [
      'd′',
      num(result.d_prime?.estimate) + ` (${num(result.d_prime?.low)}–${num(result.d_prime?.high)})`,
    ],
  ];
  return (
    <>
      <BarChart
        title="Correct answers"
        items={[{ label: 'Correct', value: result.correct ?? 0 }]}
        min={0}
        max={Math.max(result.n, 1)}
        axisLabel="Assessors"
        reference={{ value: result.n * result.guessing, label: 'Expected by guessing' }}
      />
      <DataTable
        id="discrimination-summary"
        label="Discrimination summary"
        data={rows.map(([measure, value]) => ({ measure, value }))}
        getRowId={(r) => r.measure}
        selectable={false}
        columns={[
          { accessorKey: 'measure', header: 'Measure' },
          { accessorKey: 'value', header: 'Value (95 % CI)' },
        ]}
      />
    </>
  );
}

function JARView({ result }: { result: JAR }) {
  const rows = result.attributes.flatMap((a) =>
    a.samples.map((c) => ({ key: a.question_id + c.code, attribute: a.question ?? '', ...c })),
  );
  // Label only findings (off for at least the threshold, with a drop), biggest penalty first;
  // every point keeps its tooltip and the table lists them all.
  const points = rows
    .flatMap((r) =>
      (['too_little', 'too_much'] as const)
        .filter((side) => r[`drop_${side}`] != null)
        .map((side) => ({
          label: `${r.code} ${r.attribute} ${side === 'too_little' ? 'too little' : 'too much'}`,
          x: r[side] * 100,
          y: r[`drop_${side}`]!,
          penalty: r[`penalty_${side}`] ?? 0,
          labelled: r[side] >= result.threshold && r[`drop_${side}`]! > 0,
          tip: `${r.code}: ${r.attribute} ${side === 'too_little' ? 'too little' : 'too much'} for ${pct(r[side])}, liking ${num(r[`drop_${side}`], 1)} lower`,
        })),
    )
    .sort((a, b) => b.penalty - a.penalty);
  return (
    <>
      <ScatterChart
        title="Penalty analysis"
        points={points}
        xLabel="Assessors (%)"
        yLabel="Drop in liking"
        guideX={{ value: result.threshold * 100, label: pct(result.threshold) }}
      />
      <DataTable
        id="jar-penalties"
        label="Penalty analysis"
        data={rows}
        getRowId={(r) => r.key}
        selectable={false}
        columns={[
          { accessorKey: 'attribute', header: 'Attribute' },
          { accessorKey: 'code', header: 'Sample' },
          { id: 'little', header: 'Too little', accessorFn: (r) => pct(r.too_little) },
          { id: 'right', header: 'Just right', accessorFn: (r) => pct(r.just_right) },
          { id: 'much', header: 'Too much', accessorFn: (r) => pct(r.too_much) },
          { id: 'dl', header: 'Drop (−)', accessorFn: (r) => num(r.drop_too_little, 1) },
          { id: 'dm', header: 'Drop (+)', accessorFn: (r) => num(r.drop_too_much, 1) },
          { id: 'pl', header: 'Penalty (−)', accessorFn: (r) => num(r.penalty_too_little) },
          { id: 'pm', header: 'Penalty (+)', accessorFn: (r) => num(r.penalty_too_much) },
        ]}
      />
    </>
  );
}

function CATAView({ result }: { result: CATA }) {
  return (
    <>
      {result.map && (
        <ScatterChart
          title="Samples and attributes"
          zeroLines
          legend={{ primary: 'Sample', secondary: 'Attribute' }}
          xLabel={`Dimension 1 (${num(result.map.inertia[0], 0)} %)`}
          yLabel={
            result.map.inertia[1] != null ? `Dimension 2 (${num(result.map.inertia[1], 0)} %)` : ''
          }
          points={[
            ...result.map.attributes.map((a) => ({ ...a, kind: 'secondary' as const })),
            ...result.map.samples.map((s) => ({ ...s, kind: 'primary' as const })),
          ]}
        />
      )}
      <DataTable
        id="cata-citations"
        label="Citations"
        data={result.attributes}
        getRowId={(r) => r.question_id}
        selectable={false}
        columns={[
          { id: 'attribute', header: 'Attribute', accessorFn: (r) => r.question ?? r.question_id },
          ...result.samples.map((code): ColumnDef<CATA['attributes'][number]> => ({
            id: 's-' + code,
            header: code,
            accessorFn: (r) => `${r.counts[code] ?? 0} ${r.groups[code] ?? ''}`.trim(),
          })),
          { id: 'p', header: 'p', accessorFn: (r) => p(r.p_value) },
          ...(result.liking_question
            ? [
                {
                  id: 'impact',
                  header: 'Impact on liking',
                  accessorFn: (r: CATA['attributes'][number]) => num(r.impact, 1),
                },
              ]
            : []),
        ]}
      />
    </>
  );
}

function RATAView({ result }: { result: RATA }) {
  const cell = (a: RATA['attributes'][number], code: string) =>
    a.samples.find((s) => s.code === code);
  return (
    <>
      {result.map && (
        <ScatterChart
          title="Samples and attributes"
          zeroLines
          legend={{ primary: 'Sample', secondary: 'Attribute' }}
          xLabel={`Dimension 1 (${num(result.map.inertia[0], 0)} %)`}
          yLabel={
            result.map.inertia[1] != null ? `Dimension 2 (${num(result.map.inertia[1], 0)} %)` : ''
          }
          points={[
            ...result.map.attributes.map((a) => ({ ...a, kind: 'secondary' as const })),
            ...result.map.samples.map((s) => ({ ...s, kind: 'primary' as const })),
          ]}
        />
      )}
      <DataTable
        id="rata-means"
        label="Mean ratings"
        data={result.attributes}
        getRowId={(r) => r.question_id}
        selectable={false}
        columns={[
          { id: 'attribute', header: 'Attribute', accessorFn: (r) => r.question ?? r.question_id },
          ...result.samples.map((code): ColumnDef<RATA['attributes'][number]> => ({
            id: 's-' + code,
            header: code,
            accessorFn: (r) => {
              const s = cell(r, code);
              return s ? `${num(s.mean, 1)} ${s.group ?? ''}`.trim() : '–';
            },
          })),
          { id: 'p', header: 'p', accessorFn: (r) => p(r.p_value) },
        ]}
      />
      <DataTable
        id="rata-checked"
        label="Share checked"
        data={result.attributes}
        getRowId={(r) => r.question_id}
        selectable={false}
        columns={[
          { id: 'attribute', header: 'Checked', accessorFn: (r) => r.question ?? r.question_id },
          ...result.samples.map((code): ColumnDef<RATA['attributes'][number]> => ({
            id: 'c-' + code,
            header: code,
            accessorFn: (r) => pct(cell(r, code)?.checked),
          })),
        ]}
      />
    </>
  );
}

export function AnalysisResult({
  analysis,
  busy = false,
  onDownload,
}: {
  analysis: Analysis;
  busy?: boolean;
  onDownload?: (format: 'xlsx' | 'docx') => void;
}) {
  const text = analysis.presentation;
  const result = analysis.result;
  const runtime = (analysis.runtime ?? {}) as { versions?: Record<string, string> };
  return (
    <div className="ui-stack" aria-label="Analysis result">
      <h3>
        {analysis.recipe_title} · {analysis.test_name}
      </h3>
      {analysis.status !== 'succeeded' && (
        <p role="status">
          {statusLabel(analysis.status)}
          {analysis.status === 'queued' && ': the analysis starts in a moment.'}
          {analysis.status === 'running' && ': this usually takes a few seconds.'}
          {analysis.error && ': ' + analysis.error}
        </p>
      )}
      {text && (
        <div className="ui-stack" aria-label="Answer">
          {text.answer.map((line) => (
            <p key={line}>
              <strong>{line}</strong>
            </p>
          ))}
        </div>
      )}
      {result?.recipe === 'liking-anova' && <LikingView result={result} />}
      {result?.recipe === 'discrimination' && <DiscriminationView result={result} />}
      {result?.recipe === 'jar-penalty' && <JARView result={result} />}
      {result?.recipe === 'cata' && <CATAView result={result} />}
      {result?.recipe === 'rata' && <RATAView result={result} />}
      {text && text.warnings.length > 0 && (
        <div className="ui-stack" aria-label="Warnings">
          {text.warnings.map((line) => (
            <p key={line}>Note: {line}</p>
          ))}
        </div>
      )}
      {onDownload && analysis.status === 'succeeded' && (
        <Toolbar label="Report downloads">
          <Button disabled={busy} onClick={() => onDownload('xlsx')}>
            Download Excel
          </Button>
          <Button disabled={busy} onClick={() => onDownload('docx')}>
            Download Word
          </Button>
        </Toolbar>
      )}
      {text && (
        <PropertyGrid
          sections={[
            {
              title: 'How to read this',
              children: (
                <div className="ui-stack">
                  {text.how_to_read.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              ),
            },
            {
              title: 'Details',
              children: (
                <div className="ui-stack">
                  {result?.recipe === 'liking-anova' &&
                    result.questions.map((q) => (
                      <DataTable
                        key={q.question_id}
                        id={'anova-' + q.question_id}
                        label={q.test_name}
                        data={q.table}
                        getRowId={(r) => r.term}
                        selectable={false}
                        columns={[
                          { accessorKey: 'term', header: 'Source' },
                          { id: 'df', header: 'df', accessorFn: (r) => num(r.df, 0) },
                          { id: 'ss', header: 'Sum of squares', accessorFn: (r) => num(r.sum_sq) },
                          { id: 'ms', header: 'Mean square', accessorFn: (r) => num(r.mean_sq) },
                          { id: 'f', header: 'Statistic', accessorFn: (r) => num(r.statistic) },
                          { id: 'p', header: 'p', accessorFn: (r) => p(r.p_value) },
                        ]}
                      />
                    ))}
                  <p>
                    Settings: {JSON.stringify(analysis.parameters)} · Data:{' '}
                    {analysis.snapshot_label} · R {runtime.versions?.R ?? '–'}
                  </p>
                  <p className="mono">
                    Recipe {analysis.recipe} v{analysis.recipe_version} ·{' '}
                    {analysis.recipe_sha256.slice(0, 16)} · result{' '}
                    {analysis.result_sha256?.slice(0, 16) ?? '–'} · {analysis.id}
                  </p>
                  <Button
                    compact
                    onClick={() =>
                      void navigator.clipboard?.writeText(
                        JSON.stringify(
                          {
                            id: analysis.id,
                            snapshot_id: analysis.snapshot_id,
                            recipe_sha256: analysis.recipe_sha256,
                            result_sha256: analysis.result_sha256,
                            runtime: analysis.runtime,
                          },
                          null,
                          2,
                        ),
                      )
                    }
                  >
                    Copy receipt
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

// --- Power calculator -------------------------------------------------------------------------

export function PowerCalculator({
  value,
  result,
  error,
  busy,
  onChange,
  onCalculate,
}: {
  value: PowerRequest;
  result: PowerRead | null;
  error: string;
  busy: boolean;
  onChange: (next: PowerRequest) => void;
  onCalculate: () => void;
}) {
  return (
    <div className="ui-stack">
      <p>How many assessors does a triangle, duo-trio or 2-AFC test need? No data is used.</p>
      <Field
        label="Test"
        kind="select"
        value={value.method}
        options={(['triangle', 'duo_trio', 'two_afc'] as const).map((m) => ({
          value: m,
          label: analysisWords[m],
        }))}
        onChange={(e) => onChange({ ...value, method: e.target.value as PowerRequest['method'] })}
      />
      <Field
        label="Question"
        kind="select"
        value={value.purpose ?? 'difference'}
        options={['difference', 'similarity'].map((v) => ({ value: v, label: analysisWords[v] }))}
        onChange={(e) => onChange({ ...value, purpose: e.target.value as PowerRequest['purpose'] })}
      />
      <Field
        label={
          value.purpose === 'similarity'
            ? 'Largest share still similar (%)'
            : 'Share of assessors who notice (%)'
        }
        kind="number"
        min={1}
        max={99}
        value={Math.round(value.size * 100)}
        onChange={(e) => onChange({ ...value, effect: 'pd', size: Number(e.target.value) / 100 })}
      />
      <Field
        label="Significance level"
        kind="select"
        value={String(value.alpha ?? 0.05)}
        options={alphaOptions}
        onChange={(e) =>
          onChange({ ...value, alpha: Number(e.target.value) as PowerRequest['alpha'] })
        }
      />
      <Field
        label="Power (%)"
        kind="number"
        min={50}
        max={99}
        value={Math.round((value.target_power ?? 0.8) * 100)}
        onChange={(e) => onChange({ ...value, target_power: Number(e.target.value) / 100 })}
      />
      <Toolbar label="Calculate">
        <Button disabled={busy || !(value.size > 0 && value.size < 1)} onClick={onCalculate}>
          Calculate
        </Button>
      </Toolbar>
      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status">
          {result.reachable ? (
            <>
              <strong>{result.assessors} assessors</strong>; the result is significant with{' '}
              {result.purpose === 'similarity' ? 'at most' : 'at least'} {result.critical_correct}{' '}
              correct (power {pct(result.power)}, d′ = {num(result.d_prime)}).
            </>
          ) : (
            'More than 2000 assessors would be needed; choose a larger difference.'
          )}
        </p>
      )}
    </div>
  );
}

// --- Screen -----------------------------------------------------------------------------------

export function AddOnNotice({ status }: { status: AddOnStatus | null }) {
  if (!status || status.state === 'ready') return null;
  return (
    <p role="status">
      {status.state === 'missing'
        ? 'Analysis is an optional add-on (R with SensoMineR) and is not installed on this server. Close Sensibilia, double-click “Add analysis (R)” in the Sensibilia folder, then start again. It needs internet once (about 230 MB); for a computer without internet, use “Download analysis for another computer” elsewhere and copy the folder across. Results already computed stay readable.'
        : status.message}
    </p>
  );
}

export function Analyses({
  client,
  studyId,
  version,
  active = true,
}: {
  client: Client;
  studyId: string;
  version: Version;
  active?: boolean;
}) {
  const [status, setStatus] = useState<AddOnStatus | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [rows, setRows] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Suggestion | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [staff, setStaff] = useState('');
  const [open, setOpen] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [calculator, setCalculator] = useState(false);
  const [powerValue, setPowerValue] = useState<PowerRequest>({
    method: 'triangle',
    purpose: 'difference',
    effect: 'pd',
    size: 0.3,
    alpha: 0.05,
    target_power: 0.8,
  });
  const [powerResult, setPowerResult] = useState<PowerRead | null>(null);
  const [powerError, setPowerError] = useState('');
  const generation = useRef(0);
  const published = !!version.published_at;

  const load = async () => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const [state, list, offers] = await Promise.all([
        client.analysisStatus(),
        client.analyses(studyId),
        published ? client.suggestedAnalyses(studyId, version.id) : Promise.resolve([]),
      ]);
      if (current !== generation.current) return;
      setStatus(state);
      setRows(list);
      setSuggestions(offers);
      if (open) {
        const fresh = list.find((r) => r.id === open.id);
        if (fresh && fresh.status !== open.status) setOpen(await client.analysis(studyId, open.id));
      }
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : 'Read failed');
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (active) void load();
    return () => {
      generation.current++;
    };
  }, [studyId, version.id, active]);
  // While an analysis waits or runs, look again every two seconds.
  const pending = rows.some((r) => r.status === 'queued' || r.status === 'running');
  useEffect(() => {
    if (!active || !pending) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [active, pending, open?.id, open?.status]);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };
  const choose = (s: Suggestion) => {
    setSelected(s);
    setSettings(s.settings);
    setOpen(null);
  };
  const openAnalysis = (row: Analysis) =>
    void perform(async () => {
      setSelected(null);
      setOpen(await client.analysis(studyId, row.id));
    });
  const run = () =>
    void perform(async () => {
      if (!selected) return;
      const created = await client.runAnalysis(studyId, {
        study_version_id: version.id,
        study_test_id: selected.study_test_id,
        recipe: selected.recipe,
        settings,
        staff_name: staff,
      });
      setSelected(null);
      setOpen(created);
      setRows([created, ...rows]);
    });
  const download = (format: 'xlsx' | 'docx') =>
    void perform(async () => {
      if (!open) return;
      saveBlob(
        await client.analysisReport(studyId, open.id, format),
        `${open.recipe}-${open.test_name}-${open.id.slice(0, 8)}.${format}`.replace(
          /[^\w.-]+/g,
          '-',
        ),
      );
    });

  return (
    <section className="ui-stack" aria-label="Analyses">
      <Toolbar
        label="Analysis actions"
        secondary={
          <>
            <Button disabled={loading} onClick={() => void load()}>
              Refresh
            </Button>
            <Button onClick={() => setCalculator(true)}>Assessors needed…</Button>
          </>
        }
      />
      <AddOnNotice status={status} />
      {!published && <p>Release this version to analyse its answers.</p>}
      {error && (
        <p role="alert">
          {error} <Button onClick={() => void load()}>Retry</Button>
        </p>
      )}
      <div className="ui-split">
        <div className="ui-stack">
          <h3>Suggested for this version</h3>
          <SuggestionTable
            rows={suggestions}
            selected={selected}
            onSelect={choose}
            loading={loading}
          />
          <h3>Analyses run</h3>
          <AnalysisTable rows={rows} onOpen={openAnalysis} loading={loading} />
        </div>
        <aside className="ui-split-side" aria-label="Analysis detail">
          {selected ? (
            <AnalysisSettings
              suggestion={selected}
              settings={settings}
              staff={staff}
              ready={status?.state === 'ready' && published}
              busy={busy}
              onChange={setSettings}
              onStaff={setStaff}
              onRun={run}
            />
          ) : open ? (
            <AnalysisResult analysis={open} busy={busy} onDownload={download} />
          ) : (
            <p>Choose “Set up” on a suggested analysis, or open one that has run.</p>
          )}
        </aside>
      </div>
      {calculator && (
        <SidePanel title="Assessors needed" onClose={() => setCalculator(false)}>
          <PowerCalculator
            value={powerValue}
            result={powerResult}
            error={powerError}
            busy={busy}
            onChange={(next) => {
              setPowerValue(next);
              setPowerResult(null);
            }}
            onCalculate={() =>
              void (async () => {
                setPowerError('');
                try {
                  setPowerResult(await client.power(powerValue));
                } catch (e) {
                  setPowerError(e instanceof Error ? e.message : 'Calculation failed');
                }
              })()
            }
          />
        </SidePanel>
      )}
    </section>
  );
}
