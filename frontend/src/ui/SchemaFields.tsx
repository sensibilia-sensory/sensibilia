import { useId, useState } from 'react';
import { fieldLabel, fieldLabels } from '../shared/lexicon';
import { Field } from './Field';
import { PropertyGrid } from './PropertyGrid';
import { Button } from './Button';
import { DragList, RowGrip } from './RowDrag';
import { moveItem } from './reorder';

type Schema = {
  type?: string;
  $ref?: string;
  $defs?: Record<string, Schema>;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  default?: unknown;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean;
  anyOf?: Schema[];
  oneOf?: unknown;
  allOf?: unknown;
};
const humanise = fieldLabel;

/** One new row per non-blank line. Shown for lists whose rows are only a stable id and a text. */
function BulkAdd({
  noun,
  room,
  disabled,
  onAdd,
}: {
  noun: string;
  room: number;
  disabled: boolean;
  onAdd: (lines: string[]) => void;
}) {
  const [text, setText] = useState('');
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const tooMany = lines.length > room;
  return (
    <div className="ui-stack">
      <Field
        kind="textarea"
        rows={3}
        label={'Add several ' + noun + 's at once'}
        hint={tooMany ? 'Only ' + room + ' more fit; remove some lines.' : 'One per line.'}
        error={tooMany ? 'Too many lines.' : undefined}
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        disabled={disabled || !lines.length || tooMany}
        onClick={() => {
          onAdd(lines);
          setText('');
        }}
      >
        Add {lines.length || ''} {noun}
        {lines.length === 1 ? '' : 's'}
      </Button>
    </div>
  );
}

export function SchemaFields({
  schema,
  value,
  onChange,
  labels = {},
  errors = {},
  help = {},
  disabled = false,
}: {
  schema: unknown;
  value: unknown;
  onChange: (value: unknown) => void;
  labels?: Record<string, string>;
  errors?: Record<string, string>;
  help?: Record<string, string>;
  disabled?: boolean;
}) {
  const prefix = useId();
  const root = schema as Schema;
  const resolve = (s: Schema): Schema =>
    s.$ref ? (root.$defs?.[s.$ref.split('/').pop()!] ?? {}) : s;
  const defaultValue = (s: Schema, key?: string): unknown => {
    s = resolve(s);
    if (key === 'id' && s.default === undefined) return 'id_' + crypto.randomUUID().slice(0, 8);
    if (s.default !== undefined) return structuredClone(s.default);
    if (s.type === 'object')
      return Object.fromEntries(
        Object.entries(s.properties ?? {}).map(([k, v]) => [k, defaultValue(v, k)]),
      );
    if (s.type === 'array') return [];
    if (s.type === 'boolean') return false;
    return '';
  };
  const render = (
    raw: Schema,
    val: unknown,
    set: (v: unknown) => void,
    path: string,
    required = false,
    compact = false,
  ): React.ReactNode => {
    let s = resolve(raw);
    const nullable = s.anyOf?.some((v) => v.type === 'null') ?? false;
    if (nullable) s = { ...resolve(s.anyOf!.find((v) => v.type !== 'null')!), anyOf: undefined };
    const segments = path.split('.');
    const label =
      labels[path] ??
      (segments[0] === 'scale_labels' && segments.length === 2
        ? 'Scale label ' + (Number(segments[1]) + 1)
        : segments[0] === 'questions' && segments.length === 3
          ? fieldLabel(segments[2]) + ' ' + (Number(segments[1]) + 1)
          : (fieldLabels[segments.at(-1)!] ?? path.split('.').pop())) ??
      'Value';
    const error = errors[path];
    const ownHint = help[path] ?? help[segments.at(-1)!];
    // A parent's hint is shown once, on the first item, not repeated under every item.
    const repeated = segments.length === 2 && /^\d+$/.test(segments[1]) && segments[1] !== '0';
    const hint = ownHint ?? (repeated ? undefined : help[segments[0]]);
    if (s.oneOf || s.anyOf || s.allOf || !s.type)
      return <p role="alert">Unsupported schema at {path}. Editing blocked.</p>;
    if (s.type === 'object') {
      if (s.additionalProperties !== false)
        return <p role="alert">Unsupported open object at {path}.</p>;
      const obj = (val ?? {}) as Record<string, unknown>;
      return (
        <PropertyGrid
          sections={(() => {
            const entries = Object.entries(s.properties ?? {});
            const nested = (child: Schema) => {
              const r = resolve(child);
              return r.type === 'object' || r.type === 'array';
            };
            const renderChild = (k: string, child: Schema) =>
              render(
                child,
                obj[k],
                (v) => set({ ...obj, [k]: v }),
                path ? path + '.' + k : k,
                s.required?.includes(k),
              );
            const scalars = entries.filter(([, child]) => !nested(child));
            return [
              ...(scalars.length
                ? [
                    {
                      title: 'Settings',
                      defaultOpen: true,
                      children: (
                        <>
                          {scalars.map(([k, child]) => (
                            <div key={k}>{renderChild(k, child)}</div>
                          ))}
                        </>
                      ),
                    },
                  ]
                : []),
              ...entries
                .filter(([, child]) => nested(child))
                .map(([k, child]) => ({
                  title: labels[path ? path + '.' + k : k] ?? fieldLabel(k),
                  defaultOpen: true,
                  children: renderChild(k, child),
                })),
            ];
          })()}
        />
      );
    }
    if (s.type === 'array') {
      const arr = (val ?? []) as unknown[];
      const fixed = s.minItems === s.maxItems;
      const itemSchema = resolve(s.items ?? {});
      if (itemSchema.type === 'object' && itemSchema.additionalProperties === false) {
        const columns = Object.entries(itemSchema.properties ?? {});
        const move = (index: number, direction: -1 | 1) => {
          const next = [...arr];
          [next[index], next[index + direction]] = [next[index + direction], next[index]];
          set(next);
        };
        return (
          <div className="ui-data-table ui-stack">
            <div
              className="ui-table-scroll"
              role="region"
              aria-label={label + ' editor'}
              tabIndex={0}
            >
              <table>
                <caption className="sr-only">{label}</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Drag to reorder</span>
                    </th>
                    {columns.map(([key]) => (
                      <th key={key} scope="col">
                        {humanise(key)}
                      </th>
                    ))}
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <DragList disabled={disabled} onMove={(from, to) => set(moveItem(arr, from, to))}>
                  {({ rowProps, gripProps }) => (
                    <tbody>
                      {arr.map((item, i) => (
                        <tr key={i} data-row-id={path + '.' + i} {...rowProps(i)}>
                          <td>
                            <RowGrip disabled={disabled} {...gripProps(i)} />
                          </td>
                          {columns.map(([key, child]) => (
                            <td key={key}>
                              {render(
                                child,
                                (item as Record<string, unknown>)[key],
                                (v) =>
                                  set(
                                    arr.map((x, j) =>
                                      j === i ? { ...(x as Record<string, unknown>), [key]: v } : x,
                                    ),
                                  ),
                                path + '.' + i + '.' + key,
                                itemSchema.required?.includes(key),
                                true,
                              )}
                            </td>
                          ))}
                          <td>
                            <div className="ui-inline">
                              <Button
                                size="icon"
                                aria-label={'Move ' + label + ' ' + (i + 1) + ' up'}
                                disabled={disabled || i === 0}
                                onClick={() => move(i, -1)}
                              >
                                ↑
                              </Button>
                              <Button
                                size="icon"
                                aria-label={'Move ' + label + ' ' + (i + 1) + ' down'}
                                disabled={disabled || i === arr.length - 1}
                                onClick={() => move(i, 1)}
                              >
                                ↓
                              </Button>
                              <Button
                                variant="quiet"
                                disabled={disabled || arr.length <= (s.minItems ?? 0)}
                                onClick={() => set(arr.filter((_, j) => j !== i))}
                              >
                                Remove
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  )}
                </DragList>
              </table>
            </div>
            <Button
              disabled={disabled || arr.length >= (s.maxItems ?? 100)}
              onClick={() => set([...arr, defaultValue(itemSchema)])}
            >
              Add {label.replace(/s$/, '')}
            </Button>
            {!fixed && columns.every(([key]) => ['id', 'prompt', 'required'].includes(key)) && (
              <BulkAdd
                noun={label.replace(/s$/, '').toLowerCase()}
                room={(s.maxItems ?? 100) - arr.length}
                disabled={disabled}
                onAdd={(lines) =>
                  set([
                    // Unfilled rows are dropped, so the list does not keep a blank row at the top.
                    ...arr.filter((x) => String((x as { prompt?: string }).prompt ?? '').trim()),
                    ...lines.map((prompt) => ({ ...(defaultValue(itemSchema) as object), prompt })),
                  ])
                }
              />
            )}
          </div>
        );
      }

      return (
        <div className="ui-stack">
          {arr.map((item, i) => (
            <div key={i} className="ui-stack">
              {render(
                s.items ?? {},
                item,
                (v) => set(arr.map((x, j) => (j === i ? v : x))),
                path + '.' + i,
                true,
              )}
              {!fixed && (
                <Button
                  variant="quiet"
                  disabled={disabled || arr.length <= (s.minItems ?? 0)}
                  onClick={() => set(arr.filter((_, j) => j !== i))}
                >
                  Remove {label} {i + 1}
                </Button>
              )}
            </div>
          ))}
          {!fixed && (
            <Button
              disabled={disabled || arr.length >= (s.maxItems ?? 100)}
              onClick={() => set([...arr, defaultValue(s.items ?? {})])}
            >
              Add {label.replace(/s$/, '')}
            </Button>
          )}
        </div>
      );
    }
    if (s.enum)
      return (
        <Field
          compact={compact}
          hint={hint}
          label={label}
          kind="select"
          value={String(val ?? '')}
          options={s.enum.map((x) => ({ value: String(x), label: String(x) }))}
          onChange={(e) => set(e.target.value)}
          disabled={disabled}
          error={error}
        />
      );
    if (s.type === 'boolean')
      return (
        <Field
          compact={compact}
          hint={hint}
          label={label}
          kind="checkbox"
          checked={val === true}
          onChange={(e) => set(e.target.checked)}
          disabled={disabled}
          error={error}
        />
      );
    if (s.type === 'string' || s.type === 'integer' || s.type === 'number')
      return (
        <Field
          compact={compact}
          hint={hint}
          id={prefix + '-schema-' + path}
          label={label}
          kind={s.type === 'string' ? 'text' : 'number'}
          value={String(val ?? '')}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            set(
              s.type === 'string'
                ? e.target.value
                : e.target.value === ''
                  ? nullable
                    ? null
                    : ''
                  : Number(e.target.value),
            )
          }
          required={required}
          min={s.minimum}
          max={s.maximum}
          disabled={disabled}
          error={error}
        />
      );
    return <p role="alert">Unsupported schema type at {path}.</p>;
  };
  return <>{render(root, value, onChange, '')}</>;
}
