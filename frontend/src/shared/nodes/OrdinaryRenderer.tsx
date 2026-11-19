import { useEffect, useState } from 'react';
import { Button, ChoiceGrid, ChoiceScale, Field } from '../../ui';
import type { Node, Answer, Value } from '../flow';
import { displayText } from '../flow/text';
import { NodeImages } from './AssetScope';
import { RichText } from './richText';
import { codeAnswer } from './answers';
export function OrdinaryRenderer({
  node,
  language,
  variables = {},
  tokens = false,
  answer,
  onChange,
  disabled = false,
}: {
  node: Node;
  language: string;
  variables?: Record<string, Value>;
  tokens?: boolean;
  answer?: Answer;
  onChange: (answer: Answer | undefined) => void;
  disabled?: boolean;
}) {
  const [code, setCode] = useState(answer?.state === 'code' ? answer.normalized_code : ''),
    [codeError, setCodeError] = useState('');
  useEffect(() => {
    if (node.kind !== 'code_entry' || disabled) return;
    let live = true;
    onChange(undefined);
    codeAnswer(code, node.data.normalization)
      .then((value) => {
        if (live) {
          onChange(value);
          setCodeError('');
        }
      })
      .catch(() => {
        if (live) setCodeError('Cannot hash this code in this browser.');
      });
    return () => {
      live = false;
    };
  }, [code, node.id, disabled]);
  const text = (value: Record<string, string>) =>
    displayText(value[language] ?? '', variables, tokens);
  if (node.kind === 'info')
    return (
      <>
        <RichText
          value={node.data.body[language] ?? ''}
          map={(piece) => displayText(piece, variables, tokens)}
        />
        <NodeImages ids={node.data.asset_ids ?? []} language={language} />
      </>
    );
  if (node.kind === 'confirm')
    return (
      <>
        <p>{text(node.data.body)}</p>
        <Field
          kind="checkbox"
          label={text(node.data.ack_label)}
          disabled={disabled}
          checked={answer?.state === 'continued' && answer.acknowledged}
          onChange={(e) => onChange({ state: 'continued', acknowledged: e.target.checked })}
        />
      </>
    );
  if (node.kind === 'consent')
    return (
      <>
        <p>{text(node.data.body)}</p>
        <ChoiceScale
          label="Consent choice"
          disabled={disabled}
          showValues={false}
          options={[
            { value: 'true', label: text(node.data.accept_label) },
            { value: 'false', label: text(node.data.decline_label) },
          ]}
          value={answer?.state === 'answered' ? String(answer.value) : undefined}
          onChange={(value) => onChange({ state: 'answered', value: value === 'true' })}
        />
      </>
    );
  if (node.kind === 'code_entry')
    return (
      <>
        <Field
          label={text(node.data.prompt)}
          value={code}
          disabled={disabled}
          onChange={(e) => {
            setCode(e.target.value);
            onChange(undefined);
          }}
          error={codeError || undefined}
        />
        <p>
          {node.data.allow_unknown
            ? 'Unknown or blank codes may continue.'
            : 'A matching code is required.'}
        </p>
      </>
    );
  if (node.kind === 'question') {
    const data = node.data,
      value = answer?.state === 'answered' ? answer.value : undefined;
    return (
      <div className="ui-stack">
        {data.answer_type === 'single' || data.answer_type === 'multiple' ? (
          <ChoiceScale
            disabled={disabled}
            showValues={false}
            label={text(data.prompt)}
            options={data.options!.map((o) => ({ value: o.id, label: text(o.label) }))}
            multiple={data.answer_type === 'multiple'}
            layout={data.answer_type === 'single' ? (data.layout ?? 'vertical') : 'vertical'}
            value={typeof value === 'string' || Array.isArray(value) ? value : undefined}
            onChange={(option) => {
              const id = String(option);
              if (data.answer_type === 'single') {
                onChange({ state: 'answered', value: id });
                return;
              }
              const selected = Array.isArray(value) ? value : [];
              const next = selected.includes(id)
                ? selected.filter((v) => v !== id)
                : data.options?.find((o) => o.id === id)?.exclusive
                  ? [id]
                  : [
                      ...selected.filter((v) => !data.options?.find((o) => o.id === v)?.exclusive),
                      id,
                    ];
              onChange({ state: 'answered', value: next });
            }}
          />
        ) : (
          <Field
            disabled={disabled}
            label={text(data.prompt)}
            kind={data.answer_type === 'integer' ? 'number' : 'text'}
            value={typeof value === 'string' || typeof value === 'number' ? value : ''}
            min={data.min ?? undefined}
            max={data.max ?? undefined}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange(
                e.target.value === ''
                  ? undefined
                  : {
                      state: 'answered',
                      value:
                        data.answer_type === 'integer' ? Number(e.target.value) : e.target.value,
                    },
              )
            }
          />
        )}
        {!data.required && data.answer_type === 'multiple' && (
          <Button disabled={disabled} onClick={() => onChange({ state: 'answered', value: [] })}>
            No selections
          </Button>
        )}
        {data.allow_skip && (
          <Button disabled={disabled} onClick={() => onChange({ state: 'skipped' })}>
            Skip question
          </Button>
        )}
        {answer?.state === 'skipped' && <p role="status">Explicitly skipped</p>}
      </div>
    );
  }
  if (node.kind === 'matrix_question') {
    const values = answer?.state === 'matrix' ? answer.answers : {};
    const skipRow = (rowId: string) =>
      onChange({
        state: 'matrix',
        answers: { ...values, [rowId]: { state: 'skipped', option_id: null } },
      });
    // Flows published before layouts existed carry no value: they keep the vertical lists.
    const layout = node.data.layout ?? 'vertical';
    // Every option named: one table, the options as column headings. Ends only and vertical
    // lists are one block per statement (ChoiceScale).
    if (layout === 'horizontal')
      return (
        <div className="ui-stack">
          <p>{text(node.data.instructions)}</p>
          <ChoiceGrid
            disabled={disabled}
            label={text(node.data.instructions) || 'Question grid'}
            columns={node.data.options.map((o) => ({ value: o.id, label: text(o.label) }))}
            rows={node.data.rows.map((row) => ({
              id: row.id,
              label: text(row.prompt),
              value:
                values[row.id]?.state === 'selected'
                  ? (values[row.id] as { state: 'selected'; option_id: string }).option_id
                  : undefined,
              note: values[row.id]?.state === 'skipped' && (
                <span role="status" className="ui-hint">
                  {' '}
                  Explicitly skipped
                </span>
              ),
              after: node.data.allow_skip && (
                <Button disabled={disabled} onClick={() => skipRow(row.id)}>
                  Skip {text(row.prompt)}
                </Button>
              ),
            }))}
            onChange={(rowId, optionId) =>
              onChange({
                state: 'matrix',
                answers: { ...values, [rowId]: { state: 'selected', option_id: optionId } },
              })
            }
          />
        </div>
      );
    return (
      <div className="ui-stack">
        <p>{text(node.data.instructions)}</p>
        {node.data.rows.map((row) => (
          <div key={row.id} className="ui-stack">
            <ChoiceScale
              disabled={disabled}
              showValues={false}
              layout={layout}
              label={text(row.prompt)}
              options={node.data.options.map((o) => ({ value: o.id, label: text(o.label) }))}
              value={
                values[row.id]?.state === 'selected'
                  ? (values[row.id] as { state: 'selected'; option_id: string }).option_id
                  : undefined
              }
              onChange={(value) =>
                onChange({
                  state: 'matrix',
                  answers: { ...values, [row.id]: { state: 'selected', option_id: String(value) } },
                })
              }
            />
            {node.data.allow_skip && (
              <Button
                disabled={disabled}
                onClick={() =>
                  onChange({
                    state: 'matrix',
                    answers: { ...values, [row.id]: { state: 'skipped', option_id: null } },
                  })
                }
              >
                Skip {text(row.prompt)}
              </Button>
            )}
            {values[row.id]?.state === 'skipped' && <p role="status">Explicitly skipped</p>}
          </div>
        ))}
      </div>
    );
  }
  return null;
}
