import {
  descriptorTermsValid,
  descriptorRanksValid,
  methodValuesValid,
} from './shared/methods/registry';
import { Button, ChoiceScale, DataTable, Field, SampleMap, type ScaleLayout } from './ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NewConfiguration, PreviewObservation, PublicAssignment, Sample } from './api';
import { previewAssignment } from './methods';
import { code } from './flow';

type Change = (observations: PreviewObservation[], ready: boolean) => void;
type ConfigKind<K extends NewConfiguration['kind']> = Extract<NewConfiguration, { kind: K }>;

export function MethodRenderer({
  configuration,
  assignment,
  change,
  initial = [],
  disabled = false,
  layout,
}: {
  configuration: NewConfiguration;
  assignment: PublicAssignment;
  change: Change;
  initial?: PreviewObservation[];
  disabled?: boolean;
  /** How rating scales are laid out (the step's setting); other controls are unaffected. */
  layout?: ScaleLayout;
}) {
  if (configuration.kind === 'flash_profile')
    return (
      <FlashRenderer
        configuration={configuration}
        assignment={assignment}
        change={change}
        initial={initial}
        disabled={disabled}
      />
    );
  if (configuration.kind === 'napping')
    return (
      <NappingRenderer configuration={configuration} assignment={assignment} change={change} />
    );
  if (configuration.kind === 'tcata')
    return <p>TCATA requires the shared Flow v2 preview and temporal capture.</p>;
  if (
    configuration.kind === 'triangle' ||
    configuration.kind === 'duo_trio' ||
    configuration.kind === 'two_afc'
  )
    return (
      <DiscriminationRenderer
        configuration={configuration}
        assignment={assignment}
        change={change}
        initial={initial}
        disabled={disabled}
      />
    );
  return (
    <AttributeRenderer
      configuration={configuration}
      assignment={assignment}
      change={change}
      layout={layout}
    />
  );
}

export function MethodPreview({
  configuration,
  samples,
}: {
  configuration: NewConfiguration;
  samples: Sample[];
}) {
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const callback = useRef<Change>((_, ready) => setReady(ready));
  const assignment = useMemo(
    () => previewAssignment(configuration, samples),
    [configuration, samples],
  );
  return (
    <aside className="method-preview" aria-label="Assessor preview">
      <div className="preview-toolbar">
        <span>Assessor preview</span>
        <button type="button" className="text-button" onClick={() => setRevision(revision + 1)}>
          Reset preview answers
        </button>
      </div>
      <p className="preview-caption">
        Preview answers are not collected.
        {configuration.kind === 'triangle' ||
        configuration.kind === 'duo_trio' ||
        configuration.kind === 'two_afc'
          ? ' These are representative codes; actual serving orders are assigned per session.'
          : ''}
      </p>
      <MethodRenderer
        key={revision}
        configuration={configuration}
        assignment={assignment}
        change={callback.current}
      />
      <p className="preview-answer" aria-live="polite">
        {ready ? 'Required answers complete' : 'Complete the required answers'}
      </p>
    </aside>
  );
}

function AttributeRenderer({
  configuration: config,
  assignment,
  change,
  initial = [],
  disabled = false,
  layout,
}: {
  configuration: ConfigKind<'cata' | 'rata' | 'jar'>;
  assignment: PublicAssignment;
  change: Change;
  initial?: PreviewObservation[];
  disabled?: boolean;
  layout?: ScaleLayout;
}) {
  const [values, setValues] = useState<Record<string, PreviewObservation['value']>>(() =>
    Object.fromEntries(
      initial.map((e) => [
        (e.sample_id ?? assignment.samples[0]?.slot_id ?? '') + ':' + e.question_id,
        e.value,
      ]),
    ),
  );
  const products = assignment.samples.length
    ? assignment.samples
    : [{ slot_id: '', sample_id: undefined, code: '' }];
  const key = (sample: string, question: string) => `${sample}:${question}`;
  useEffect(() => {
    const observations: PreviewObservation[] = [];
    for (const product of products)
      for (const question of config.questions) {
        const value =
          values[key(product.slot_id, question.id)] ??
          (config.kind === 'jar'
            ? undefined
            : config.kind === 'cata'
              ? { kind: 'cata' as const, state: 'unselected' as const }
              : { kind: 'rata' as const, state: 'unselected' as const, rating: null });
        if (value)
          observations.push({
            sample_id: product.sample_id ?? null,
            question_id: question.id,
            value,
          });
      }
    change(
      observations,
      products.every((product) =>
        methodValuesValid(
          config,
          Object.fromEntries(
            observations
              .filter((e) => e.sample_id === (product.sample_id ?? null))
              .map((e) => [e.question_id, e.value]),
          ),
          assignment,
        ),
      ),
    );
  }, [values, config, assignment, change]);
  function set(sample: string, question: string, value: PreviewObservation['value']) {
    setValues({ ...values, [key(sample, question)]: value });
  }
  return (
    <div className="ui-stack">
      <p>{config.instructions}</p>
      {products.map((product) => (
        <section key={product.slot_id} className="ui-stack">
          {product.code && <h3>Sample {product.code}</h3>}
          {config.questions.map((question) => {
            const value = values[key(product.slot_id, question.id)];
            const selected = value?.state === 'selected';
            const rating = value && 'rating' in value ? value.rating : null;
            return (
              <div key={question.id} className="ui-stack">
                {config.kind !== 'jar' && (
                  <ChoiceScale
                    label={question.prompt || 'Attribute'}
                    options={[{ value: 'applies', label: 'Applies' }]}
                    multiple
                    showValues={false}
                    value={selected ? ['applies'] : []}
                    disabled={disabled}
                    onChange={() =>
                      set(
                        product.slot_id,
                        question.id,
                        config.kind === 'cata'
                          ? { kind: 'cata', state: selected ? 'unselected' : 'selected' }
                          : {
                              kind: 'rata',
                              state: selected ? 'unselected' : 'selected',
                              rating: null,
                            },
                      )
                    }
                  />
                )}{' '}
                {(config.kind === 'jar' || (config.kind === 'rata' && selected)) && (
                  <ChoiceScale
                    label={question.prompt + ': rating'}
                    layout={layout}
                    disabled={disabled}
                    value={rating ?? undefined}
                    options={config.scale_labels!.map((label, i) => ({
                      value: i + (config.kind === 'rata' ? (config.rating_min ?? 1) : 1),
                      label,
                    }))}
                    onChange={(v) =>
                      set(
                        product.slot_id,
                        question.id,
                        config.kind === 'rata'
                          ? { kind: 'rata', state: 'selected', rating: Number(v) }
                          : { kind: 'jar', state: 'rated', rating: Number(v) },
                      )
                    }
                  />
                )}{' '}
                {config.allow_skips && (
                  <Button
                    disabled={disabled}
                    onClick={() =>
                      set(
                        product.slot_id,
                        question.id,
                        config.kind === 'cata'
                          ? { kind: 'cata', state: 'skipped' }
                          : config.kind === 'rata'
                            ? { kind: 'rata', state: 'skipped', rating: null }
                            : { kind: 'jar', state: 'skipped', rating: null },
                      )
                    }
                  >
                    Skip {question.prompt}
                  </Button>
                )}{' '}
                {value?.state === 'skipped' && <p role="status">Explicitly skipped</p>}
                {config.kind === 'rata' && selected && rating == null && (
                  <p>
                    {config.require_ratings ? 'Choose a rating.' : 'Selected without a rating.'}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function DiscriminationRenderer({
  configuration: config,
  assignment,
  change,
  initial = [],
  disabled = false,
}: {
  configuration: ConfigKind<'triangle' | 'duo_trio' | 'two_afc'>;
  assignment: PublicAssignment;
  change: Change;
  initial?: PreviewObservation[];
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState(() => {
    const value = initial[0]?.value;
    return value && 'selected_slot_id' in value ? value.selected_slot_id : '';
  });
  useEffect(() => {
    change(
      selected
        ? [
            {
              sample_id: null,
              question_id: 'choice',
              value: {
                kind: config.kind,
                state: 'chosen',
                selected_slot_id: selected as 's1' | 's2' | 's3',
              },
            },
          ]
        : [],
      !!selected,
    );
  }, [selected, config, change]);
  return (
    <div className="ui-stack">
      <p>{config.instructions}</p>
      {assignment.reference && (
        <p>
          Reference sample <strong>{assignment.reference.code}</strong>
        </p>
      )}
      <ChoiceScale
        disabled={disabled}
        label={
          config.kind === 'two_afc'
            ? config.question
            : config.kind === 'triangle'
              ? 'Which sample is different?'
              : 'Which sample matches the reference?'
        }
        showValues={false}
        value={selected}
        options={assignment.samples.map((sample, i) => ({
          value: sample.slot_id,
          label: 'Position ' + (i + 1) + ' · Sample ' + sample.code,
        }))}
        onChange={(v) => setSelected(String(v))}
      />
    </div>
  );
}

type Descriptor = { id: string; term: string; ranks: Record<string, number> };
function FlashRenderer({
  configuration: config,
  assignment,
  change,
  initial = [],
  disabled = false,
}: {
  configuration: ConfigKind<'flash_profile'>;
  assignment: PublicAssignment;
  change: Change;
  initial?: PreviewObservation[];
  disabled?: boolean;
}) {
  const [attributes, setAttributes] = useState<Descriptor[]>(() => {
    const value = initial[0]?.value;
    return value && 'attributes' in value
      ? value.attributes
      : [{ id: code('descriptor'), term: '', ranks: {} }];
  });
  const [ranking, setRanking] = useState(!!initial.length);
  const termsValid = descriptorTermsValid(config, attributes);
  const ranksValid = descriptorRanksValid(config, assignment, attributes);
  const ready = ranking && termsValid && ranksValid && assignment.samples.length >= 2;
  useEffect(() => {
    change(
      ready
        ? [
            {
              sample_id: null,
              question_id: 'profile',
              value: { kind: 'flash_profile', state: 'profile', attributes },
            },
          ]
        : [],
      ready,
    );
  }, [attributes, ready, change]);
  return (
    <div className="ui-stack">
      <p>{config.instructions}</p>
      <p>Samples: {assignment.samples.map((s) => s.code).join(' · ')}</p>
      {!ranking ? (
        <>
          <p>{config.descriptor_instructions}</p>
          <DataTable
            id="flash-descriptors"
            selectable={false}
            virtualize={false}
            wide
            label="Your sensory descriptors"
            data={attributes}
            getRowId={(a) => a.id}
            columns={[
              { accessorKey: 'id', header: 'ID' },
              {
                id: 'term',
                header: 'Descriptor',
                cell: ({ row }) => (
                  <Field
                    compact
                    label={'Descriptor ' + (row.index + 1)}
                    value={row.original.term}
                    disabled={disabled}
                    onChange={(e) =>
                      setAttributes(
                        attributes.map((old, i) =>
                          i === row.index ? { ...old, term: e.target.value } : old,
                        ),
                      )
                    }
                  />
                ),
              },
            ]}
            rowActions={(a) => (
              <Button
                disabled={disabled || attributes.length <= (config.min_attributes ?? 1)}
                onClick={() => setAttributes(attributes.filter((old) => old.id !== a.id))}
              >
                Remove
              </Button>
            )}
          />
          <Button
            disabled={disabled || attributes.length >= (config.max_attributes ?? 20)}
            onClick={() =>
              setAttributes([...attributes, { id: code('descriptor'), term: '', ranks: {} }])
            }
          >
            Add descriptor
          </Button>
          <Button
            disabled={disabled || !termsValid || assignment.samples.length < 2}
            onClick={() => setRanking(true)}
          >
            Rank the samples
          </Button>
        </>
      ) : (
        <>
          <p>{config.ranking_instructions}</p>
          <p>
            Rank 1 is lowest intensity.{' '}
            {config.allow_ties
              ? 'Ties share a rank; use consecutive ranks (e.g. 1, 1, 2).'
              : 'Use each rank exactly once.'}
          </p>
          <DataTable
            id="flash-ranks"
            selectable={false}
            virtualize={false}
            wide
            label="Sample ranks"
            data={attributes}
            getRowId={(a) => a.id}
            columns={[
              { accessorKey: 'term', header: 'Descriptor' },
              ...assignment.samples.map((sample) => ({
                id: sample.slot_id,
                header: 'Sample ' + sample.code,
                cell: ({ row }: { row: { original: Descriptor; index: number } }) => (
                  <Field
                    compact
                    label={row.original.term + ': sample ' + sample.code + ' rank'}
                    kind="select"
                    value={String(row.original.ranks[sample.sample_id!] ?? '')}
                    disabled={disabled}
                    options={[
                      { value: '', label: 'Choose rank' },
                      ...assignment.samples.map((_, i) => ({
                        value: String(i + 1),
                        label: String(i + 1),
                      })),
                    ]}
                    onChange={(e) => {
                      const ranks = { ...row.original.ranks };
                      if (e.target.value) ranks[sample.sample_id!] = Number(e.target.value);
                      else delete ranks[sample.sample_id!];
                      setAttributes(
                        attributes.map((old, i) => (i === row.index ? { ...old, ranks } : old)),
                      );
                    }}
                  />
                ),
              })),
            ]}
          />
          {!ranksValid && <p>Complete every rank and check the tie rule.</p>}
          <Button disabled={disabled} onClick={() => setRanking(false)}>
            Edit descriptors
          </Button>
        </>
      )}
    </div>
  );
}

type Point = { x: number; y: number; description: string };
function NappingRenderer({
  configuration: config,
  assignment,
  change,
  initial = [],
  disabled = false,
}: {
  configuration: ConfigKind<'napping'>;
  assignment: PublicAssignment;
  change: Change;
  initial?: PreviewObservation[];
  disabled?: boolean;
}) {
  const [points, setPoints] = useState<Record<string, Point>>(() => {
    const value = initial[0]?.value;
    return value && 'points' in value
      ? Object.fromEntries(
          Object.entries(value.points).map(([id, p]) => [
            id,
            { ...p, description: p.description ?? '' },
          ]),
        )
      : {};
  });
  const ready =
    assignment.samples.length >= 2 && assignment.samples.every((s) => points[s.sample_id!] != null);
  useEffect(() => {
    change(
      ready
        ? [
            {
              sample_id: null,
              question_id: 'map',
              value: { kind: 'napping', state: 'mapped', points },
            },
          ]
        : [],
      ready,
    );
  }, [points, ready, change]);
  return (
    <div className="ui-stack">
      <p>{config.instructions}</p>
      <SampleMap
        samples={assignment.samples.map((s) => ({ id: s.sample_id!, code: s.code }))}
        points={points}
        onChange={setPoints}
        disabled={disabled}
      />
      {config.collect_descriptions &&
        assignment.samples
          .filter((s) => points[s.sample_id!])
          .map((s) => (
            <Field
              key={s.slot_id}
              label={'Description for sample ' + s.code}
              value={points[s.sample_id!].description}
              disabled={disabled}
              onChange={(e) =>
                setPoints({
                  ...points,
                  [s.sample_id!]: { ...points[s.sample_id!], description: e.target.value },
                })
              }
            />
          ))}
    </div>
  );
}
