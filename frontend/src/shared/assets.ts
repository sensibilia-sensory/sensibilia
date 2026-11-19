import type { components } from '../api-schema';
import { outline, type Flow } from './flow';
import { STORAGE_TIMEOUT_MS, withTimeout } from './timeout';
export type Asset = components['schemas']['AssetManifest'];
export const stimulusCache = 'sensibilia-stimuli-1';
export const stimulusKey = (sha: string) => location.origin + '/assessor/stimuli/' + sha;
export const requiredAssetIds = (flow: Flow) =>
  new Set(
    outline(flow.nodes).flatMap(({ node }) =>
      node.kind === 'info' ? (node.data.asset_ids ?? []) : [],
    ),
  );
export async function verifyImage(blob: Blob, asset: Asset): Promise<Blob> {
  if (
    blob.size !== asset.byte_size ||
    asset.media_type !== 'image/png' ||
    !/^[a-f0-9]{64}$/.test(asset.sha256)
  )
    throw new Error('Stimulus size/type does not match the frozen manifest.');
  const bytes = await blob.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (digest !== asset.sha256)
    throw new Error('Stimulus checksum does not match the frozen manifest.');
  const image = await createImageBitmap(blob);
  const valid = image.width === asset.width && image.height === asset.height;
  image.close();
  if (!valid) throw new Error('Stimulus dimensions do not match the frozen manifest.');
  return blob;
}
export async function readCachedImage(asset: Asset) {
  const cache = await withTimeout(
    caches.open(stimulusCache),
    STORAGE_TIMEOUT_MS,
    'Tablet image storage did not respond. Preparation did not complete; retry with staff.',
  );
  const response = await cache.match(stimulusKey(asset.sha256));
  if (!response)
    throw new Error(
      'A frozen stimulus is missing from this tablet. Ask staff to prepare it again; saved answers are retained.',
    );
  return verifyImage(await response.blob(), asset);
}
export async function cacheImages(pkg: components['schemas']['PackageRead'], token: string) {
  const flow = pkg.flow as Flow;
  const ids = requiredAssetIds(flow);
  const assets = pkg.assets ?? [];
  if (
    assets.length !== ids.size ||
    new Set(assets.map((a) => a.id)).size !== assets.length ||
    assets.some((a) => !ids.has(a.id) || a.study_version_id !== pkg.study_version.id)
  )
    throw new Error('Frozen stimulus manifest is incomplete or belongs to another version.');
  const cache = await withTimeout(
    caches.open(stimulusCache),
    STORAGE_TIMEOUT_MS,
    'Tablet image storage did not respond. Preparation did not complete; retry with staff.',
  );
  for (const asset of assets) {
    if (asset.url !== '/sessions/' + pkg.session.id + '/assets/' + asset.sha256)
      throw new Error('Frozen stimulus URL does not belong to the assigned assessment.');
    try {
      await readCachedImage(asset);
      continue;
    } catch {
      /* Repair only from the authenticated frozen bytes. */
    }
    const response = await fetch(asset.url, {
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        'Frozen stimulus is unavailable. Preparation did not complete; retry with staff.',
      );
    const blob = await verifyImage(await response.blob(), asset);
    await cache.put(
      stimulusKey(asset.sha256),
      new Response(blob, { headers: { 'Content-Type': 'image/png' } }),
    );
    await readCachedImage(asset);
  }
}
