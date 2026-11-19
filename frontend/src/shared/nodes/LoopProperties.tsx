import { Button, DataTable, dropIndex, moveItem } from '../../ui';
import { SampleCreator } from './SampleCreator';
import type { components } from '../../api-schema';
import type { Node, Sample } from '../flow';
type Loop = Extract<Node, { kind: 'loop_samples' }>;
export function LoopProperties({
  node,
  samples,
  disabled = false,
  onChange,
  onCreate,
}: {
  node: Loop;
  samples: Sample[];
  disabled?: boolean;
  onChange: (node: Loop) => void;
  onCreate: (payload: components['schemas']['SampleCreate']) => Promise<Sample>;
}) {
  const change = (ids: string[]) => onChange({ ...node, data: { ...node.data, sample_ids: ids } });
  const move = (id: string, offset: number) => {
    const ids = [...node.data.sample_ids],
      i = ids.indexOf(id);
    if (i >= 0 && ids[i + offset]) {
      [ids[i], ids[i + offset]] = [ids[i + offset], ids[i]];
      change(ids);
    }
  };
  return (
    <div className="ui-stack">
      <DataTable
        id="loop-samples"
        label="Loop samples"
        reorder={
          disabled
            ? undefined
            : {
                canDrag: (s) => node.data.sample_ids.includes(s.id),
                onMove: (fromId, toId, position) => {
                  const ids = node.data.sample_ids,
                    from = ids.indexOf(fromId),
                    target = ids.indexOf(toId);
                  if (from >= 0 && target >= 0)
                    change(moveItem(ids, from, dropIndex(from, target, position)));
                },
              }
        }
        data={[...samples]
          // Included samples first, in loop order, so the table shows the order they are served in.
          .sort((a, b) => {
            const ia = node.data.sample_ids.indexOf(a.id),
              ib = node.data.sample_ids.indexOf(b.id);
            return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
          })
          .map((sample) => ({
            ...sample,
            position: node.data.sample_ids.includes(sample.id)
              ? node.data.sample_ids.indexOf(sample.id) + 1
              : '—',
          }))}
        getRowId={(s) => s.id}
        virtualize={false}
        columns={[
          { accessorKey: 'position', header: 'Order' },
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
        ]}
        emptyText="No samples. Create a sample below."
        rowActions={(s) => (
          <div className="ui-inline">
            <Button
              compact
              disabled={disabled}
              onClick={() =>
                change(
                  node.data.sample_ids.includes(s.id)
                    ? node.data.sample_ids.filter((id) => id !== s.id)
                    : [...node.data.sample_ids, s.id],
                )
              }
            >
              {node.data.sample_ids.includes(s.id) ? 'Remove' : 'Include'} {s.code}
            </Button>
            <Button
              compact
              aria-label={'Move ' + s.code + ' up'}
              disabled={disabled || node.data.sample_ids.indexOf(s.id) <= 0}
              onClick={() => move(s.id, -1)}
            >
              ↑
            </Button>
            <Button
              compact
              aria-label={'Move ' + s.code + ' down'}
              disabled={
                disabled ||
                !node.data.sample_ids.includes(s.id) ||
                node.data.sample_ids.indexOf(s.id) === node.data.sample_ids.length - 1
              }
              onClick={() => move(s.id, 1)}
            >
              ↓
            </Button>
          </div>
        )}
      />
      <SampleCreator
        title="Create loop sample"
        disabled={disabled}
        onCreate={onCreate}
        onCreated={(sample) => change([...node.data.sample_ids, sample.id])}
      />
      {disabled && <p>Published loop order and sample metadata are read-only.</p>}
    </div>
  );
}
