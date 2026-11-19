import { DataTable, technical } from '../ui';
import { outline, type Flow } from '../shared/flow';
import type { Asset } from '../shared/assets';
export function StimulusManifest({ flow, assets }: { flow: Flow; assets: Asset[] }) {
  const rows = outline(flow.nodes).flatMap(({ node, number }) =>
    node.kind === 'info'
      ? (node.data.asset_ids ?? []).map((id, i) => ({
          id: node.id + ':' + id,
          node: node.id,
          number,
          position: i + 1,
          asset_id: id,
          ...assets.find((a) => a.id === id),
        }))
      : [],
  );
  return (
    <DataTable
      id="publication-stimuli"
      label="Frozen stimulus references"
      data={rows}
      getRowId={(r) => r.node + ':' + r.asset_id}
      selectable={false}
      virtualize={false}
      wide
      columns={[
        { accessorKey: 'number', header: 'Step' },
        { accessorKey: 'node', header: 'Step ID', meta: technical },
        { accessorKey: 'position', header: 'Order' },
        { accessorKey: 'asset_id', header: 'Image ID', meta: technical },
        { accessorKey: 'study_version_id', header: 'Version' },
        { accessorKey: 'media_type', header: 'Type' },
        { accessorKey: 'sha256', header: 'SHA-256' },
        { accessorKey: 'byte_size', header: 'Bytes' },
        {
          id: 'pixels',
          header: 'Pixels',
          accessorFn: (r) => (r.width && r.height ? r.width + ' × ' + r.height : 'Missing'),
        },
        {
          id: 'alt',
          header: 'Reviewed alt text',
          accessorFn: (r) =>
            flow.languages.map((l) => l + ': ' + (r.alt_text?.[l] ?? 'Missing')).join(' | '),
        },
      ]}
      emptyText="No image references."
    />
  );
}
