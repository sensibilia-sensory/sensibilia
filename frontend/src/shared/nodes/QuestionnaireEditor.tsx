import { useEffect, useState } from 'react';
import {
  Button,
  DataTable,
  Field,
  PropertyGrid,
  Tabs,
  Toolbar,
  dropIndex,
  moveItem,
  technical,
} from '../../ui';
import type { Node } from '../flow';
import { appendBatteryRows, translateBatteryRows } from './authoring';
import { ScaleBuilder, ScaleLayoutField } from './ScaleSettings';

type Editable = Extract<Node, { kind: 'matrix_question' | 'question' }>;
export function QuestionnaireEditor({
  node,
  language,
  disabled = false,
  errors = {},
  focusField = '',
  onChange,
}: {
  node: Editable;
  language: string;
  disabled?: boolean;
  errors?: Record<string, string>;
  focusField?: string;
  onChange: (node: Node) => void;
}) {
  const [tab, setTab] = useState(node.kind === 'matrix_question' ? 'rows' : 'scale');
  const [batches, setBatches] = useState<Record<string, { bulk?: string; translations?: string }>>(
    {},
  );
  const bulk = batches[language]?.bulk ?? '',
    translations = batches[language]?.translations ?? '';
  const setBulk = (value: string) =>
    setBatches((previous) => ({ ...previous, [language]: { ...previous[language], bulk: value } }));
  const setTranslations = (value: string) =>
    setBatches((previous) => ({
      ...previous,
      [language]: { ...previous[language], translations: value },
    }));
  const [required, setRequired] = useState(true),
    [error, setError] = useState('');
  const [remove, setRemove] = useState('');
  useEffect(() => {
    if (!focusField.startsWith('rows.') && !focusField.startsWith('options.')) return;
    setTab(focusField.startsWith('rows.') ? 'rows' : 'scale');
    requestAnimationFrame(() =>
      document.getElementById(node.id + '-schema-' + focusField)?.focus(),
    );
  }, [focusField, node.id, language]);
  const move = <T,>(items: T[], index: number, direction: number) => {
    const next = [...items];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    return next;
  };
  const options = node.data.options ?? [];
  const setOptions = (next: typeof options) =>
    onChange({ ...node, data: { ...node.data, options: next } } as Node);
  const actions = (
    id: string,
    index: number,
    count: number,
    onMove: (direction: number) => void,
    onRemove: () => void,
    minimum: number,
  ) => (
    <div className="ui-inline">
      <Button
        size="icon"
        aria-label={'Move ' + id + ' up'}
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
      >
        ↑
      </Button>
      <Button
        size="icon"
        aria-label={'Move ' + id + ' down'}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
      >
        ↓
      </Button>
      <Button variant="quiet" disabled={disabled || count <= minimum} onClick={() => setRemove(id)}>
        Delete
      </Button>
      {remove === id && (
        <>
          <Button
            variant="danger"
            disabled={disabled}
            onClick={() => {
              onRemove();
              setRemove('');
            }}
          >
            Confirm delete
          </Button>
          <Button onClick={() => setRemove('')}>Cancel</Button>
        </>
      )}
    </div>
  );
  const scale = (
    <div className="ui-stack">
      <Toolbar label="Scale editing">
        <Button
          disabled={disabled || options.length >= (node.kind === 'matrix_question' ? 11 : 100)}
          onClick={() => {
            let id: string;
            do {
              id = 'option_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
            } while (options.some((o) => o.id === id));
            setOptions([
              ...options,
              {
                id,
                label: { [language]: '' },
                exclusive: false,
                ...(node.kind === 'matrix_question' ? { score: null } : {}),
              },
            ]);
          }}
        >
          Add scale option
        </Button>
      </Toolbar>
      <ScaleLayoutField node={node} disabled={disabled} onChange={onChange} />
      <ScaleBuilder node={node} language={language} disabled={disabled} onChange={onChange} />
      <DataTable
        id={'questionnaire-scale-' + node.id}
        label="Questionnaire scale"
        selectable={false}
        virtualize={false}
        data={options.map((o, i) => ({ ...o, position: i + 1 }))}
        getRowId={(o) => o.id}
        columns={[
          { accessorKey: 'position', header: 'Order' },
          { accessorKey: 'id', header: 'Option ID', meta: technical },
          {
            id: 'label',
            header: 'Label · ' + language,
            accessorFn: (o) => o.label[language] ?? '',
            cell: ({ row }) => (
              <Field
                compact
                id={node.id + '-schema-options.' + (row.original.position - 1) + '.label'}
                error={errors['options.' + (row.original.position - 1) + '.label']}
                label={'Scale label ' + row.original.id}
                value={row.original.label[language] ?? ''}
                disabled={disabled}
                onChange={(e) =>
                  setOptions(
                    options.map((o) =>
                      o.id === row.original.id
                        ? { ...o, label: { ...o.label, [language]: e.target.value } }
                        : o,
                    ),
                  )
                }
              />
            ),
          },
          ...(node.kind === 'matrix_question'
            ? [
                {
                  id: 'score',
                  header: 'Score',
                  accessorFn: (o: (typeof options)[number]) => o.score ?? '',
                  cell: ({ row }: { row: { original: (typeof options)[number] } }) => (
                    <Field
                      compact
                      id={
                        node.id +
                        '-schema-options.' +
                        options.findIndex((o) => o.id === row.original.id) +
                        '.score'
                      }
                      error={
                        errors[
                          'options.' + options.findIndex((o) => o.id === row.original.id) + '.score'
                        ]
                      }
                      label={'Scale score ' + row.original.id}
                      kind="number"
                      value={row.original.score ?? ''}
                      disabled={disabled}
                      step="any"
                      hint="Blank means no numeric score. Zero is a score."
                      onChange={(e) =>
                        setOptions(
                          options.map((o) =>
                            o.id === row.original.id
                              ? {
                                  ...o,
                                  score: e.target.value === '' ? null : Number(e.target.value),
                                }
                              : o,
                          ),
                        )
                      }
                    />
                  ),
                },
              ]
            : []),
          ...(node.kind === 'question' && node.data.answer_type === 'multiple'
            ? [
                {
                  id: 'exclusive',
                  header: 'Exclusive',
                  accessorFn: (o: (typeof options)[number]) => (o.exclusive ? 'Yes' : 'No'),
                  cell: ({ row }: { row: { original: (typeof options)[number] } }) => (
                    <Field
                      compact
                      label={'Exclusive ' + row.original.id}
                      kind="checkbox"
                      checked={row.original.exclusive ?? false}
                      disabled={disabled}
                      onChange={(e) =>
                        setOptions(
                          options.map((o) =>
                            o.id === row.original.id ? { ...o, exclusive: e.target.checked } : o,
                          ),
                        )
                      }
                    />
                  ),
                },
              ]
            : []),
        ]}
        reorder={
          disabled
            ? undefined
            : {
                onMove: (fromId, toId, position) => {
                  const from = options.findIndex((x) => x.id === fromId),
                    target = options.findIndex((x) => x.id === toId);
                  setOptions(moveItem(options, from, dropIndex(from, target, position)));
                },
              }
        }
        rowActions={(o) => {
          const i = options.findIndex((x) => x.id === o.id);
          return actions(
            o.id,
            i,
            options.length,
            (d) => setOptions(move(options, i, d)),
            () => setOptions(options.filter((x) => x.id !== o.id)),
            2,
          );
        }}
      />
    </div>
  );
  const rows =
    node.kind === 'matrix_question' ? (
      <div className="ui-stack">
        <DataTable
          id={'questionnaire-rows-' + node.id}
          label="Battery rows"
          selectable={false}
          virtualize={false}
          data={node.data.rows.map((r, i) => ({ ...r, position: i + 1 }))}
          getRowId={(r) => r.id}
          columns={[
            { accessorKey: 'position', header: 'Order' },
            { accessorKey: 'id', header: 'Row ID', meta: technical },
            {
              id: 'prompt',
              header: 'Prompt · ' + language,
              accessorFn: (r) => r.prompt[language] ?? '',
              cell: ({ row }) => (
                <Field
                  compact
                  id={node.id + '-schema-rows.' + (row.original.position - 1) + '.prompt'}
                  error={errors['rows.' + (row.original.position - 1) + '.prompt']}
                  label={'Row prompt ' + row.original.id}
                  value={row.original.prompt[language] ?? ''}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({
                      ...node,
                      data: {
                        ...node.data,
                        rows: node.data.rows.map((r) =>
                          r.id === row.original.id
                            ? { ...r, prompt: { ...r.prompt, [language]: e.target.value } }
                            : r,
                        ),
                      },
                    })
                  }
                />
              ),
            },
            {
              id: 'required',
              header: 'Required',
              accessorFn: (r) => (r.required ? 'Yes' : 'No'),
              cell: ({ row }) => (
                <Field
                  compact
                  label={'Required ' + row.original.id}
                  kind="checkbox"
                  checked={row.original.required}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({
                      ...node,
                      data: {
                        ...node.data,
                        rows: node.data.rows.map((r) =>
                          r.id === row.original.id ? { ...r, required: e.target.checked } : r,
                        ),
                      },
                    })
                  }
                />
              ),
            },
          ]}
          reorder={
            disabled
              ? undefined
              : {
                  onMove: (fromId, toId, position) => {
                    const rows = node.data.rows,
                      from = rows.findIndex((x) => x.id === fromId),
                      target = rows.findIndex((x) => x.id === toId);
                    onChange({
                      ...node,
                      data: {
                        ...node.data,
                        rows: moveItem(rows, from, dropIndex(from, target, position)),
                      },
                    });
                  },
                }
          }
          rowActions={(r) => {
            const i = node.data.rows.findIndex((x) => x.id === r.id);
            return actions(
              r.id,
              i,
              node.data.rows.length,
              (d) =>
                onChange({ ...node, data: { ...node.data, rows: move(node.data.rows, i, d) } }),
              () =>
                onChange({
                  ...node,
                  data: { ...node.data, rows: node.data.rows.filter((x) => x.id !== r.id) },
                }),
              1,
            );
          }}
        />
        <PropertyGrid
          sections={[
            {
              title: 'Bulk row entry · ' + language,
              children: (
                <>
                  <Field
                    kind="textarea"
                    label="New row prompts"
                    value={bulk}
                    disabled={disabled}
                    onChange={(e) => setBulk(e.target.value)}
                    hint="One prompt per line. Append creates stable row IDs; other-language text must be reviewed separately."
                  />
                  <Field
                    kind="checkbox"
                    label="New rows required"
                    checked={required}
                    disabled={disabled}
                    onChange={(e) => setRequired(e.target.checked)}
                  />
                  <Button
                    disabled={disabled || !bulk.trim()}
                    onClick={() => {
                      try {
                        onChange(appendBatteryRows(node, bulk, language, required));
                        setBulk('');
                        setError('');
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Append reviewed rows
                  </Button>
                </>
              ),
            },
            {
              title: 'Bulk translations · ' + language,
              children: (
                <>
                  <Field
                    kind="textarea"
                    label="Reviewed row translations"
                    value={translations}
                    disabled={disabled}
                    onChange={(e) => setTranslations(e.target.value)}
                    hint="One row ID, tab, and reviewed prompt per line. Updates existing IDs only; preserves other languages."
                  />
                  <Button
                    disabled={disabled || !translations.trim()}
                    onClick={() => {
                      try {
                        onChange(translateBatteryRows(node, translations, language));
                        setTranslations('');
                        setError('');
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Apply reviewed translations
                  </Button>
                </>
              ),
            },
          ]}
        />
      </div>
    ) : null;
  return (
    <section className="ui-stack" aria-label="Questionnaire block editor">
      {error && <p role="alert">{error}</p>}
      <Tabs
        label="Questionnaire editing"
        value={tab}
        onChange={(next) => {
          setTab(next);
          setRemove('');
        }}
        tabs={[
          ...(rows ? [{ id: 'rows', label: 'Battery rows', content: rows }] : []),
          { id: 'scale', label: 'Scale options', content: scale },
        ]}
      />
    </section>
  );
}
