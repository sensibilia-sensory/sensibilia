import { useState } from 'react';
import type { components } from '../api-schema';
import type { Method } from './client';
import { defaultConfiguration } from '../methods';
import { Plus } from 'lucide-react';
import { Button, DataTable, EditableTable, Field, moveItem } from '../ui';

export type BatteryRequest = components['schemas']['StudyFromSamples'];
type MethodChoice = { key: string; methodId: string; text: string };
type ParsedSample = { code: string; label: string; problem: string };
export type Battery = { samplesText: string; methods: MethodChoice[] };
export const emptyBattery: Battery = { samplesText: '', methods: [] };

/** Methods answered once per sample; the others compare several samples and are added in Build. */
const perSample = ['hedonic-9-v1', 'cata-v1', 'rata-v1', 'jar-v1', 'tcata-v1'];

export const isBlank = (b: Battery) => !b.samplesText.trim() && !b.methods.length;

/** One sample per line: "code, label" (tab or semicolon also work). A bare label gets code S1, S2… */
export function parseSamples(text: string): ParsedSample[] {
  const rows = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const at = line.search(/[\t,;]/);
      const code = at < 0 ? 'S' + (i + 1) : line.slice(0, at).trim();
      const label = at < 0 ? line : line.slice(at + 1).trim();
      return { code, label, problem: '' };
    });
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.code.length > 40 || !/^[A-Za-z0-9_-]+( [A-Za-z0-9_-]+)*$/.test(row.code))
      row.problem =
        'Code: letters, digits, - or _; single spaces between words, up to 40 characters.';
    else if (seen.has(row.code)) row.problem = 'Duplicate code.';
    else if (!row.label || row.label.length > 250) row.problem = 'Label needs 1–250 characters.';
    seen.add(row.code);
  }
  return rows;
}

const attributeLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export function batteryProblems(b: Battery): string[] {
  const samples = parseSamples(b.samplesText);
  const problems: string[] = [];
  if (samples.length < 2) problems.push('Add at least two samples, one per line.');
  samples.forEach((s) => s.problem && problems.push(`${s.code || 'Sample'}: ${s.problem}`));
  if (!b.methods.length) problems.push('Add at least one method.');
  b.methods.forEach((m, i) => {
    if (!attributeLines(m.text).length)
      problems.push(
        `Method ${i + 1}: ${m.methodId === 'hedonic-9-v1' ? 'enter the question' : 'enter at least one attribute'}.`,
      );
  });
  return problems;
}

export function batteryRequest(
  b: Battery,
  methods: Method[],
  title: string,
  description: string,
): BatteryRequest {
  const configure = (m: MethodChoice): BatteryRequest['methods'][number] => {
    const lines = attributeLines(m.text);
    if (m.methodId === 'hedonic-9-v1')
      return {
        test_type_id: m.methodId,
        configuration: {
          instructions: 'Evaluate the sample, then answer the question below.',
          questions: [{ id: 'overall_liking', prompt: lines[0], required: true }],
          scale_labels: methods.find((x) => x.id === m.methodId)?.default_scale_labels ?? [],
          allow_skips: false,
        },
      };
    const base = defaultConfiguration(m.methodId, []);
    const items = lines.map((prompt, i) => ({
      id: 'attribute_' + (i + 1),
      prompt,
      required: true,
    }));
    return {
      test_type_id: m.methodId,
      configuration:
        'attributes' in base ? { ...base, attributes: items } : { ...base, questions: items },
    } as BatteryRequest['methods'][number];
  };
  return {
    title,
    description,
    language: 'en',
    samples: parseSamples(b.samplesText).map(({ code, label }) => ({ code, label })),
    methods: b.methods.map(configure),
  };
}

export function SampleBattery({
  value,
  methods,
  disabled,
  onChange,
}: {
  value: Battery;
  methods: Method[];
  disabled: boolean;
  onChange: (battery: Battery) => void;
}) {
  const [adding, setAdding] = useState(perSample[0]);
  const samples = parseSamples(value.samplesText);
  const name = (id: string) => methods.find((m) => m.id === id)?.name ?? id;
  const setMethods = (next: MethodChoice[]) => onChange({ ...value, methods: next });
  const move = (i: number, offset: number) => {
    const next = [...value.methods];
    [next[i], next[i + offset]] = [next[i + offset], next[i]];
    setMethods(next);
  };
  return (
    <div className="ui-stack">
      <Field
        label="Samples"
        kind="textarea"
        rows={3}
        placeholder={'C1, Cheddar\nC2, Gouda'}
        disabled={disabled}
        value={value.samplesText}
        hint="One per line as “code, label”, for example “C1, Cheddar”. A line with only a label gets the code S1, S2…. Assessors see the code, not the label."
        onChange={(e) => onChange({ ...value, samplesText: e.target.value })}
      />
      {samples.length > 0 && (
        <DataTable
          id="battery-samples"
          label="Samples to create"
          compact
          virtualize={false}
          data={samples.map((s, i) => ({ ...s, order: i + 1 }))}
          getRowId={(s) => String(s.order)}
          columns={[
            { accessorKey: 'order', header: 'Order' },
            { accessorKey: 'code', header: 'Code' },
            {
              accessorKey: 'label',
              header: 'Label',
              // The problem sits in the row, not in a column that appears and disappears while typing.
              cell: ({ row }) =>
                row.original.problem
                  ? row.original.label + ' · ' + row.original.problem
                  : row.original.label,
            },
          ]}
        />
      )}
      <div className="ui-inline">
        <Field
          label="Method for each sample"
          kind="select"
          disabled={disabled}
          value={adding}
          options={perSample.map((id) => ({ value: id, label: name(id) }))}
          onChange={(e) => setAdding(e.target.value)}
        />
        <Button
          disabled={disabled}
          onClick={() =>
            setMethods([...value.methods, { key: crypto.randomUUID(), methodId: adding, text: '' }])
          }
        >
          <Plus /> Add method
        </Button>
      </div>
      {value.methods.length > 0 && (
        <EditableTable
          onMove={
            disabled ? undefined : (from, to) => setMethods(moveItem(value.methods, from, to))
          }
          label="Methods run for each sample"
          rows={value.methods}
          getRowId={(m) => m.key}
          columns={[
            { header: 'Order', cell: (_m, i) => i + 1 },
            { header: 'Method', cell: (m) => name(m.methodId) },
            {
              header: 'Question or attributes (one per line)',
              cell: (m, i) => (
                <Field
                  compact
                  kind="textarea"
                  rows={m.methodId === 'hedonic-9-v1' ? 1 : 3}
                  disabled={disabled}
                  label={`${name(m.methodId)} ${i + 1} text`}
                  value={m.text}
                  onChange={(e) =>
                    setMethods(
                      value.methods.map((x) =>
                        x.key === m.key ? { ...x, text: e.target.value } : x,
                      ),
                    )
                  }
                />
              ),
            },
            {
              header: 'Actions',
              cell: (m, i) => (
                <div className="ui-inline">
                  <Button compact disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                    Up
                  </Button>
                  <Button
                    compact
                    disabled={disabled || i === value.methods.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    Down
                  </Button>
                  <Button
                    compact
                    variant="danger"
                    disabled={disabled}
                    onClick={() => setMethods(value.methods.filter((x) => x.key !== m.key))}
                  >
                    Remove
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
