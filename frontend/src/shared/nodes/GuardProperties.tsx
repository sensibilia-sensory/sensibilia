import { Button, Field, Popover, PropertyGrid } from '../../ui';
import {
  conditionText,
  legalTargets,
  outline,
  variablesFor,
  type Flow,
  type Node,
  type Test,
  type Condition,
} from '../flow';
const parseLiteral = (text: string, type: string | undefined, list: boolean) => {
  if (list) {
    if (!text.trim()) return [];
    const values = text.split(',').map((v) => v.trim());
    if (type === 'number')
      return values.every((v) => v !== '' && Number.isFinite(Number(v)))
        ? values.map(Number)
        : text;
    if (type === 'boolean')
      return values.every((v) => v === 'true' || v === 'false')
        ? values.map((v) => v === 'true')
        : text;
    return values;
  }
  return type === 'number' && text !== '' && Number.isFinite(Number(text)) ? Number(text) : text;
};
import { operatorsFor } from '../flow/validation';
export function GuardProperties({
  flow,
  node,
  tests = [],
  disabled = false,
  errors = {},
  onChange,
}: {
  flow: Flow;
  node: Node;
  tests?: Test[];
  disabled?: boolean;
  errors?: Record<string, string>;
  onChange: (node: Node) => void;
}) {
  const entries = outline(flow.nodes),
    index = entries.findIndex((e) => e.node.id === node.id);
  const loopScope = (id: string) =>
    entries
      .find((e) => e.node.id === id)
      ?.ancestors.find((a) => entries.find((e) => e.node.id === a)?.node.kind === 'loop_samples');
  const currentLoop = loopScope(node.id);
  const variables = variablesFor(flow, tests).filter(
    (v) =>
      (!v.source || entries.findIndex((e) => e.node.id === v.source) < index) &&
      (!(v.key.startsWith('sample.') || v.key.startsWith('derived.')) || !!currentLoop) &&
      (!v.source || !loopScope(v.source) || loopScope(v.source) === currentLoop),
  );
  const make = (): Condition => ({
    variable: 'context.language',
    operator: 'eq',
    value: flow.default_language,
  });
  const edit = (
    condition: Condition,
    update: (value: Condition) => void,
    depth = 1,
    path = '1',
  ): React.ReactNode => {
    if ('all' in condition || 'any' in condition) {
      const key = 'all' in condition ? 'all' : 'any',
        children = 'all' in condition ? condition.all : condition.any;
      return (
        <div className="ui-stack ui-condition-children">
          <Field
            label={'Combine ' + path}
            kind="select"
            value={key}
            disabled={disabled}
            options={[
              { value: 'all', label: 'AND' },
              { value: 'any', label: 'OR' },
            ]}
            onChange={(e) =>
              update(e.target.value === 'all' ? { all: children } : { any: children })
            }
          />
          {children.map((child, i) => (
            <div className="ui-stack" key={i}>
              {edit(
                child,
                (c) =>
                  update(
                    key === 'all'
                      ? { all: children.map((x, j) => (j === i ? c : x)) }
                      : { any: children.map((x, j) => (j === i ? c : x)) },
                  ),
                depth + 1,
                path + '.' + (i + 1),
              )}
              <Button
                variant="quiet"
                disabled={disabled || children.length === 1}
                onClick={() =>
                  update(
                    key === 'all'
                      ? { all: children.filter((_, j) => j !== i) }
                      : { any: children.filter((_, j) => j !== i) },
                  )
                }
              >
                Remove condition {path + '.' + (i + 1)}
              </Button>
            </div>
          ))}
          <Button
            disabled={disabled || children.length >= 20}
            onClick={() =>
              update(
                key === 'all' ? { all: [...children, make()] } : { any: [...children, make()] },
              )
            }
          >
            Add condition {path}
          </Button>
          <Button disabled={disabled} onClick={() => update(children[0])}>
            Unwrap {path}
          </Button>
        </div>
      );
    }
    const variable = variables.find((v) => v.key === condition.variable),
      op = condition.operator;
    const operators = operatorsFor(variable);
    const literal = 'value' in condition ? condition.value : undefined;
    const list =
      op === 'in' ||
      op === 'intersects' ||
      (variable?.type === 'set' && (op === 'eq' || op === 'neq'));
    const boolean = variable?.type === 'boolean' && !list;
    const number = variable?.type === 'number' && !list;
    const fallback = (operator: string) =>
      operator === 'is_defined'
        ? undefined
        : operator === 'in' ||
            operator === 'intersects' ||
            (variable?.type === 'set' && (operator === 'eq' || operator === 'neq'))
          ? []
          : variable?.type === 'boolean'
            ? false
            : variable?.type === 'number'
              ? 0
              : '';
    const changeOp = (operator: string) =>
      update(
        operator === 'is_defined'
          ? { variable: condition.variable, operator: 'is_defined' }
          : {
              variable: condition.variable,
              operator: operator as Exclude<typeof op, 'is_defined'>,
              value: fallback(operator)!,
            },
      );
    return (
      <div className="ui-stack">
        <Field
          label={'Answer or setting ' + path}
          kind="select"
          disabled={disabled}
          value={condition.variable}
          options={[
            ...variables.map((v) => ({
              value: v.key,
              label: v.label + ' · ' + v.type + (v.required ? '' : ' · optional'),
            })),
            ...(!variable
              ? [{ value: condition.variable, label: 'Unknown: ' + condition.variable }]
              : []),
          ]}
          onChange={(e) => {
            const v = variables.find((v) => v.key === e.target.value);
            update({
              variable: e.target.value,
              operator: 'eq',
              value:
                v?.type === 'set'
                  ? []
                  : v?.type === 'number'
                    ? 0
                    : v?.type === 'boolean'
                      ? false
                      : '',
            });
          }}
        />
        <Field
          label={'Comparison ' + path}
          kind="select"
          disabled={disabled}
          value={op}
          options={[...operators, ...(!operators.includes(op) ? [op] : [])].map((value) => ({
            value,
            label:
              (
                {
                  eq: 'Equals',
                  neq: 'Does not equal',
                  gt: 'Greater than',
                  gte: 'At least',
                  lt: 'Less than',
                  lte: 'At most',
                  in: 'Is one of',
                  intersects: 'Has any in common',
                  is_defined: 'Has an answer',
                } as Record<string, string>
              )[value] ?? value,
          }))}
          onChange={(e) => changeOp(e.target.value)}
        />
        {op !== 'is_defined' &&
          (boolean ? (
            <Field
              label={'Compare with ' + path}
              kind="select"
              disabled={disabled}
              value={String(literal)}
              options={[
                { value: 'true', label: 'True' },
                { value: 'false', label: 'False' },
              ]}
              onChange={(e) => update({ ...condition, value: e.target.value === 'true' })}
            />
          ) : (
            <Field
              label={'Compare with ' + path}
              kind={number ? 'number' : 'text'}
              error={
                (number && typeof literal !== 'number') || (list && !Array.isArray(literal))
                  ? 'Enter values of the selected variable type.'
                  : undefined
              }
              disabled={disabled}
              value={
                list ? (Array.isArray(literal) ? literal.join(', ') : '') : String(literal ?? '')
              }
              hint={
                list
                  ? 'Comma-separated values; empty means an empty set.'
                  : variable?.options
                    ? 'Stable option IDs: ' + variable.options.join(', ')
                    : undefined
              }
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                update({
                  ...condition,
                  value: parseLiteral(e.target.value, variable?.type, list),
                })
              }
            />
          ))}
        <div className="ui-inline">
          <Button
            disabled={disabled || depth >= 4}
            onClick={() => update({ all: [condition, make()] })}
          >
            AND {path}
          </Button>
          <Button
            disabled={disabled || depth >= 4}
            onClick={() => update({ any: [condition, make()] })}
          >
            OR {path}
          </Button>
        </div>
      </div>
    );
  };
  const action = node.otherwise?.action ?? 'continue',
    targets = legalTargets(flow, node.id, action).filter(
      (e) =>
        action !== 'end_study' ||
        (e.node.kind === 'end' && e.node.data.outcome === 'screened_out' && !e.node.guard),
    );
  const target = node.otherwise && 'target_id' in node.otherwise ? node.otherwise.target_id : '';
  const text = target ? entries.find((e) => e.node.id === target) : undefined;
  return (
    <PropertyGrid
      sections={[
        {
          title: 'Entry conditions',
          defaultOpen: true,
          children: (
            <div className="ui-stack">
              <p>{conditionText(node.guard, flow, tests)}</p>
              <Popover label="Show only if" disabled={disabled} summary="Edit condition">
                <Field
                  label="Show if"
                  error={errors.guard}
                  kind="select"
                  value={node.guard ? 'condition' : 'always'}
                  disabled={disabled}
                  options={[
                    { value: 'always', label: 'Always' },
                    { value: 'condition', label: 'Condition' },
                  ]}
                  onChange={(e) =>
                    onChange({ ...node, guard: e.target.value === 'always' ? null : make() })
                  }
                />
                {node.guard && edit(node.guard, (guard) => onChange({ ...node, guard }))}
              </Popover>
              <Field
                label="If condition is not met"
                error={errors.otherwise}
                kind="select"
                disabled={disabled}
                value={action}
                options={[
                  'continue',
                  'skip_to',
                  'end_study',
                  'previous_question',
                  ...(entries[index]?.ancestors.some(
                    (id) => entries.find((e) => e.node.id === id)?.node.kind === 'loop_samples',
                  )
                    ? ['next_sample']
                    : []),
                ].map((value) => ({
                  value,
                  label:
                    (
                      {
                        continue: 'Continue',
                        skip_to: 'Go to step',
                        end_study: 'End assessment',
                        next_sample: 'Next sample',
                        previous_question: 'Previous question (review only)',
                      } as Record<string, string>
                    )[value] ?? value,
                }))}
                onChange={(e) => {
                  const next = e.target.value as typeof action;
                  const destination = legalTargets(flow, node.id, next).find(
                    (e) =>
                      next !== 'end_study' ||
                      (e.node.kind === 'end' &&
                        e.node.data.outcome === 'screened_out' &&
                        !e.node.guard),
                  );
                  onChange({
                    ...node,
                    otherwise:
                      next === 'skip_to' || next === 'end_study'
                        ? { action: next, target_id: destination?.node.id ?? node.id }
                        : { action: next as 'continue' | 'previous_question' | 'next_sample' },
                  });
                }}
              />
              {(action === 'skip_to' || action === 'end_study') && (
                <Field
                  label="If condition is not met target"
                  kind="select"
                  value={target}
                  disabled={disabled}
                  options={[
                    ...targets.map((e) => ({
                      value: e.node.id,
                      label: e.number + ' ' + e.node.title[flow.default_language],
                    })),
                    ...(!targets.some((e) => e.node.id === target)
                      ? [{ value: target, label: 'Illegal/missing target ' + target }]
                      : []),
                  ]}
                  onChange={(e) =>
                    onChange({ ...node, otherwise: { action, target_id: e.target.value } })
                  }
                />
              )}
              {target && (
                <p>
                  Destination: {text?.number ?? '?'}{' '}
                  {text?.node.title[flow.default_language] ?? 'Missing'} · {target}
                </p>
              )}
              {action === 'previous_question' && (
                <p>
                  Displays the previous answered question without editing. Return resumes after this
                  omitted node.
                </p>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}
