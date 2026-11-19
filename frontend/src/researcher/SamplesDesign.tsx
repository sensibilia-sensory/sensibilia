import { useEffect, useState } from 'react';
import type { components } from '../api-schema';
import { Button, DataTable, Field, PropertyGrid, SidePanel, Toolbar, technical } from '../ui';
import { outline, type Sample, type Flow } from '../shared/flow';
import { LinearPreview } from '../shared/nodes/LinearPreview';
import { Client, type Version, type Test } from './client';
export type Design = components['schemas']['DesignRead'];
type Algorithm = components['schemas']['DesignGenerate']['algorithm'];

export function SampleTable({
  samples,
  loading = false,
  error = '',
  readOnly = false,
  onEdit,
  onDelete,
  id = 'study-samples',
}: {
  id?: string;
  samples: Sample[];
  loading?: boolean;
  error?: string;
  readOnly?: boolean;
  onEdit?: (s: Sample) => void;
  onDelete?: (s: Sample) => void;
}) {
  return (
    <div className="ui-stack">
      {loading && (
        <p role="status" aria-busy="true">
          Loading samples…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {readOnly && <p>Published sample metadata and codes are read-only.</p>}
      <DataTable
        id={id}
        label="Study samples"
        data={samples}
        getRowId={(s) => s.id}
        columns={[
          { accessorKey: 'code', header: 'Code' },
          { accessorKey: 'label', header: 'Private label' },
          {
            id: 'tags',
            header: 'Ingredient tags',
            accessorFn: (s) =>
              s.ingredient_tags == null
                ? 'Unreviewed'
                : s.ingredient_tags.join(', ') || 'Reviewed none',
          },
          { accessorKey: 'id', header: 'Sample ID', meta: technical },
          { accessorKey: 'study_version_id', header: 'Version ID', meta: technical },
        ]}
        emptyText={loading ? 'Loading samples…' : 'No samples. Create a draft sample.'}
        rowActions={(s) => (
          <div className="ui-inline">
            <Button
              compact
              disabled={readOnly || loading}
              aria-label="Edit sample"
              onClick={() => onEdit?.(s)}
            >
              Edit
            </Button>
            <Button
              compact
              disabled={readOnly || loading}
              aria-label="Delete sample"
              onClick={() => onDelete?.(s)}
            >
              Delete
            </Button>
          </div>
        )}
      />
    </div>
  );
}
export function DesignTable({
  designs,
  samples,
  loading = false,
  error = '',
  readOnly = false,
  onReview,
  onDelete,
}: {
  designs: Design[];
  samples: Sample[];
  loading?: boolean;
  error?: string;
  readOnly?: boolean;
  onReview?: (d: Design) => void;
  onDelete?: (d: Design) => void;
}) {
  return (
    <div className="ui-stack">
      {loading && (
        <p role="status" aria-busy="true">
          Loading designs…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {readOnly && (
        <p>
          Published designs are frozen. Allocation counts provisioned assessments; abandoned
          allocations remain.
        </p>
      )}
      <DataTable
        id="study-designs"
        label="Sample designs"
        data={designs}
        getRowId={(d) => d.id}
        columns={[
          { accessorKey: 'loop_id', header: 'Loop ID', meta: technical },
          { id: 'algorithm', header: 'Algorithm', accessorFn: (d) => String(d.settings.algorithm) },
          { id: 'objective', header: 'Objective', accessorFn: (d) => String(d.settings.objective) },
          { id: 'seed', header: 'Seed', accessorFn: (d) => String(d.settings.seed) },
          { id: 'rows', header: 'Sequences', accessorFn: (d) => d.sequences.length },
          {
            id: 'block',
            header: 'Block / replicates',
            accessorFn: (d) =>
              String(d.settings.block ?? 'complete') +
              (d.settings.block_size ? ' (' + String(d.settings.block_size) + ')' : '') +
              ' / ' +
              String(d.settings.replicates ?? 1),
          },
          {
            id: 'policy',
            header: 'Allocation',
            accessorFn: () => 'Provisioned; retain replacements',
          },
        ]}
        emptyText="No generated design. Loops use their explicit fixed order."
        rowActions={(d) => (
          <div className="ui-inline">
            <Button compact aria-label="Review sequences" onClick={() => onReview?.(d)}>
              Review
            </Button>
            <Button
              compact
              disabled={readOnly || loading}
              aria-label="Remove design"
              onClick={() => onDelete?.(d)}
            >
              Remove
            </Button>
          </div>
        )}
      />
      {designs.length > 0 && <SequenceTable design={designs[0]} samples={samples} />}
    </div>
  );
}
export function SequenceTable({
  design,
  samples,
  id = 'design-sequences',
}: {
  design: Design;
  samples: Sample[];
  id?: string;
}) {
  return (
    <DataTable
      id={id}
      label="Design sequences"
      data={design.sequences.map((ids, i) => ({
        id: String(i),
        sequence: i + 1,
        codes: ids.map((id) => samples.find((s) => s.id === id)?.code ?? id).join(' → '),
      }))}
      getRowId={(r) => r.id}
      columns={[
        { accessorKey: 'sequence', header: 'Sequence' },
        { accessorKey: 'codes', header: 'Serving code order' },
      ]}
      emptyText="No sequences."
    />
  );
}

export function SamplesDesign({
  client,
  studyId,
  version,
  samples,
  tests,
  tab,
  onChanged,
  blocked = false,
  active = true,
}: {
  client: Client;
  studyId: string;
  version: Version;
  samples: Sample[];
  tests: Test[];
  tab: 'samples' | 'design' | 'blinding';
  onChanged: () => Promise<unknown>;
  blocked?: boolean;
  active?: boolean;
}) {
  const [designs, setDesigns] = useState<Design[]>([]),
    [allocations, setAllocations] = useState<components['schemas']['AllocationRead'][]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [panel, setPanel] = useState(''),
    [edited, setEdited] = useState<Sample>(),
    [review, setReview] = useState<Design>();
  const [code, setCode] = useState(''),
    [label, setLabel] = useState(''),
    [tags, setTags] = useState(''),
    [reviewed, setReviewed] = useState(false);
  const [seed, setSeed] = useState('42'),
    [algorithm, setAlgorithm] = useState<Algorithm>('fixed'),
    [count, setCount] = useState('24'),
    [blockSize, setBlockSize] = useState('2');
  const [loopId, setLoopId] = useState(''),
    [sequence, setSequence] = useState('0'),
    [offset, setOffset] = useState(0);
  const [deleteSample, setDeleteSample] = useState<Sample>(),
    [deleteDesign, setDeleteDesign] = useState<Design>();
  const flow: Flow | undefined = version.form?.schema_version === 2 ? version.form : undefined;
  const loops = flow ? outline(flow.nodes).filter((e) => e.node.kind === 'loop_samples') : [];
  const readOnly = !!version.published_at,
    disabled = readOnly || blocked || busy || loading;
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [d, a] = await Promise.all([
        client.designs(studyId, version.id),
        client.allocations(studyId, version.id, offset),
      ]);
      setDesigns(d);
      setAllocations(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Read failed');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (active) void load();
  }, [client, studyId, version.id, version.revision_hash, offset, active]);
  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if ((await onChanged()) === false)
        throw new Error(
          'Settings saved, but refreshing the study failed. Reload before another change.',
        );
      await load();
      setPanel('');
      setDeleteSample(undefined);
      setDeleteDesign(undefined);
      setNotice('Saved. Check the changed study before release.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };
  const edit = (s?: Sample) => {
    setEdited(s);
    setCode(s?.code ?? '');
    setLabel(s?.label ?? '');
    setTags(s?.ingredient_tags?.join(', ') ?? '');
    setReviewed(s?.ingredient_tags != null);
    setPanel('sample');
  };
  const reviewDesign = (d: Design) => {
    setReview(d);
    setSequence('0');
    setPanel('review');
  };
  const payload = () => ({
    code,
    label,
    ingredient_tags: reviewed
      ? [
          ...new Set(
            tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ]
      : null,
  });
  return (
    <section className="ui-stack" aria-label="Samples design and blinding">
      <Toolbar label="Sample management actions">
        <span>
          Version {version.version_number} · {readOnly ? 'Published' : 'Draft'}
        </span>
        {tab === 'samples' && (
          <Button variant="primary" disabled={disabled} onClick={() => edit()}>
            Create sample
          </Button>
        )}
        {tab === 'design' && (
          <Button
            variant="primary"
            disabled={disabled || !loops.length}
            onClick={() => {
              setLoopId(loops[0]?.node.id ?? '');
              setPanel('generate');
            }}
          >
            Generate design
          </Button>
        )}
        {tab === 'blinding' && (
          <Button
            variant="primary"
            disabled={disabled || !samples.length}
            onClick={() => setPanel('blind')}
          >
            Generate blinding codes
          </Button>
        )}
        <Button disabled={busy} onClick={() => void load()}>
          Retry read
        </Button>
      </Toolbar>
      {blocked && <p role="status">Save the study sequence before changing samples or designs.</p>}
      {busy && (
        <p role="status" aria-busy="true">
          Saving sample settings…
        </p>
      )}
      {error && <p role="alert">{error} Edits are retained. Reload the study after a conflict.</p>}
      {notice && <p role="status">{notice}</p>}
      {tab === 'design' ? (
        <>
          <DesignTable
            designs={designs}
            samples={samples}
            loading={loading}
            readOnly={readOnly || blocked || busy}
            onReview={reviewDesign}
            onDelete={setDeleteDesign}
          />
          <details>
            <summary>Allocation history ({allocations.length} on this page)</summary>
            <DataTable
              id="design-allocations"
              label="Design allocations"
              data={allocations}
              getRowId={(a) => a.id}
              columns={[
                { accessorKey: 'design_id', header: 'Design ID', meta: technical },
                { accessorKey: 'session_id', header: 'Assessment ID', meta: technical },
                { accessorKey: 'ordinal', header: 'Allocation (zero based)' },
                { accessorKey: 'sequence_index', header: 'Sequence (zero based)' },
              ]}
              emptyText="No allocated assessments."
            />
            <Toolbar>
              <Button
                disabled={loading || offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 100))}
              >
                Previous allocations
              </Button>
              <Button
                disabled={loading || allocations.length < 100}
                onClick={() => setOffset(offset + 100)}
              >
                Next allocations
              </Button>
            </Toolbar>
          </details>
        </>
      ) : (
        <SampleTable
          id={tab === 'blinding' ? 'study-blinding' : 'study-samples'}
          samples={samples}
          loading={loading}
          readOnly={readOnly || blocked || busy}
          onEdit={edit}
          onDelete={setDeleteSample}
        />
      )}
      {deleteSample && (
        <Toolbar label="Confirm sample deletion">
          <span>
            Delete {deleteSample.code}? Referenced samples cannot be deleted; audit history remains.
          </span>
          <Button
            disabled={disabled}
            onClick={() =>
              void mutate(() =>
                client.deleteSample(studyId, version.id, deleteSample.id, version.revision_hash),
              )
            }
          >
            Confirm delete sample
          </Button>
          <Button onClick={() => setDeleteSample(undefined)}>Cancel</Button>
        </Toolbar>
      )}
      {deleteDesign && (
        <Toolbar label="Confirm design removal">
          <span>Remove this design? The loop returns to its explicit fixed order.</span>
          <Button
            disabled={disabled}
            onClick={() =>
              void mutate(() =>
                client.deleteDesign(studyId, version.id, deleteDesign.id, version.revision_hash),
              )
            }
          >
            Confirm remove design
          </Button>
          <Button onClick={() => setDeleteDesign(undefined)}>Cancel</Button>
        </Toolbar>
      )}
      {panel && (
        <SidePanel
          title={
            panel === 'sample'
              ? 'Sample properties'
              : panel === 'generate'
                ? 'Generate sample design'
                : panel === 'blind'
                  ? 'Generate blinding codes'
                  : 'Review sample design'
          }
          onClose={() => setPanel('')}
        >
          {panel === 'sample' && (
            <>
              <PropertyGrid
                sections={[
                  {
                    title: 'Sample metadata',
                    defaultOpen: true,
                    children: (
                      <>
                        <Field
                          label="Sample code"
                          value={code}
                          disabled={disabled}
                          onChange={(e) => setCode(e.target.value)}
                        />
                        <Field
                          label="Private label"
                          value={label}
                          disabled={disabled}
                          onChange={(e) => setLabel(e.target.value)}
                          hint="Researchers only; never sent to assessors."
                        />
                        <Field
                          label="Ingredient tags"
                          value={tags}
                          disabled={disabled}
                          onChange={(e) => setTags(e.target.value)}
                          hint="Exact comma-separated tags for restriction matching."
                        />
                        <Field
                          label="Tags reviewed"
                          kind="checkbox"
                          checked={reviewed}
                          disabled={disabled}
                          onChange={(e) => setReviewed(e.target.checked)}
                          hint="Reviewed empty means no mapped ingredients; unchecked means unknown."
                        />
                      </>
                    ),
                  },
                ]}
              />
              <Toolbar>
                <Button
                  disabled={disabled || !code || !label}
                  onClick={() =>
                    void mutate(() =>
                      edited
                        ? client.updateSample(studyId, version.id, edited.id, {
                            ...payload(),
                            revision_hash: version.revision_hash,
                          })
                        : client.createSample(studyId, {
                            ...payload(),
                            revision_hash: version.revision_hash,
                          }),
                    )
                  }
                >
                  Save sample
                </Button>
              </Toolbar>
            </>
          )}
          {panel === 'generate' && (
            <>
              <PropertyGrid
                sections={[
                  {
                    title: 'Design settings',
                    defaultOpen: true,
                    children: (
                      <>
                        <Field
                          label="Sample loop"
                          kind="select"
                          value={loopId}
                          options={loops.map((e) => ({
                            value: e.node.id,
                            label: e.number + ' ' + e.node.title[flow!.default_language],
                          }))}
                          onChange={(e) => setLoopId(e.target.value)}
                          disabled={disabled}
                        />
                        <Field
                          label="Design algorithm"
                          kind="select"
                          value={algorithm}
                          options={[
                            { value: 'fixed', label: 'Fixed — explicit loop order' },
                            { value: 'shuffle', label: 'Seeded independent shuffle' },
                            { value: 'latin', label: 'Cyclic Latin square — position balance' },
                            {
                              value: 'incomplete',
                              label: 'Incomplete blocks — pair incidence and position',
                            },
                            {
                              value: 'williams',
                              label: 'Williams — first-order carryover balance',
                            },
                          ]}
                          onChange={(e) => setAlgorithm(e.target.value as Algorithm)}
                          disabled={disabled}
                        />
                        <Field
                          label="Design seed"
                          kind="number"
                          value={seed}
                          onChange={(e) => setSeed(e.target.value)}
                          disabled={disabled}
                        />
                        {algorithm === 'shuffle' && (
                          <Field
                            label="Shuffle sequences"
                            kind="number"
                            value={count}
                            onChange={(e) => setCount(e.target.value)}
                            disabled={disabled}
                          />
                        )}
                        {algorithm === 'incomplete' && (
                          <Field
                            label="Samples per assessor"
                            kind="number"
                            value={blockSize}
                            onChange={(e) => setBlockSize(e.target.value)}
                            disabled={disabled}
                            hint="2 ≤ block size < loop sample count; all subsets with positional rotations, at most 1000 sequences. No carryover-balance claim."
                          />
                        )}
                        <Field
                          label="Block policy"
                          value={
                            algorithm === 'incomplete'
                              ? 'Incomplete; one serving per selected sample'
                              : 'Complete; one serving per sample per loop'
                          }
                          readOnly
                          onChange={() => {}}
                        />
                        <Field
                          label="Allocation basis"
                          value="Provisioned assessments"
                          readOnly
                          onChange={() => {}}
                        />
                        <Field
                          label="Replacement policy"
                          value="Retain previous allocation; allocate next"
                          readOnly
                          onChange={() => {}}
                        />
                      </>
                    ),
                  },
                ]}
              />
              <p>
                Balance applies across a complete cycle, not a partial or completed-only cohort.
                Shuffle does not guarantee balance. Separate loops represent repeated rounds;
                incomplete blocks use every subset with positional rotations and at most 1000
                sequences.
              </p>
              <p>
                <a
                  href="https://www.publish.csiro.au/ch/ch9490149"
                  target="_blank"
                  rel="noreferrer"
                >
                  Williams (1949), residual-effect balanced designs
                </a>
              </p>
              <Button
                disabled={disabled || !loopId || seed.trim() === ''}
                onClick={() =>
                  void mutate(() =>
                    client.generateDesign(studyId, version.id, {
                      revision_hash: version.revision_hash,
                      loop_id: loopId,
                      algorithm,
                      seed: Number(seed),
                      sequence_count: Number(count),
                      allocation_basis: 'provisioned',
                      replacement_policy: 'retain_and_allocate_next',
                      block: algorithm === 'incomplete' ? 'incomplete' : 'complete',
                      block_size: algorithm === 'incomplete' ? Number(blockSize) : null,
                      replicates: 1,
                    }),
                  )
                }
              >
                Generate and save design
              </Button>
            </>
          )}
          {panel === 'blind' && (
            <>
              <PropertyGrid
                sections={[
                  {
                    title: 'Blinding',
                    defaultOpen: true,
                    children: (
                      <Field
                        label="Blinding seed"
                        kind="number"
                        value={seed}
                        onChange={(e) => setSeed(e.target.value)}
                        disabled={disabled}
                      />
                    ),
                  },
                ]}
              />
              <p>
                Replace every draft sample code with a unique three-digit code. Review the full
                mapping before release. A fixed seed reproduces codes within this sample inventory;
                copies have fresh IDs.
              </p>
              <Button
                disabled={disabled || seed.trim() === ''}
                onClick={() =>
                  void mutate(() =>
                    client.blind(studyId, version.id, {
                      revision_hash: version.revision_hash,
                      seed: Number(seed),
                    }),
                  )
                }
              >
                Confirm generate blinding codes
              </Button>
            </>
          )}
          {panel === 'review' && review && (
            <>
              <p>
                {String(review.settings.algorithm)} · seed {String(review.settings.seed)} ·{' '}
                {review.sequences.length} sequences · provisioned allocation
              </p>
              <SequenceTable id="review-sequences" design={review} samples={samples} />
              <Field
                label="Rehearsal sequence"
                kind="select"
                value={sequence}
                options={review.sequences.map((_, i) => ({
                  value: String(i),
                  label: 'Sequence ' + (i + 1),
                }))}
                onChange={(e) => setSequence(e.target.value)}
              />
              {flow && (
                <LinearPreview
                  key={review.id + ':' + sequence + ':' + version.revision_hash}
                  flow={flow}
                  tests={tests}
                  samples={samples}
                  designs={designs}
                  sequenceIndex={Number(sequence)}
                />
              )}
            </>
          )}
        </SidePanel>
      )}
    </section>
  );
}
