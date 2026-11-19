import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Button, ImageStimulus } from '../../ui';
import { requiredAssetIds, verifyImage, type Asset } from '../assets';
import type { Flow } from '../flow';
const Images = createContext<Record<string, { asset: Asset; src: string }>>({});
export type ImageLoader = (asset: Asset) => Promise<Blob>;
export function AssetScope({
  assets,
  flow,
  load,
  children,
}: {
  assets: Asset[];
  flow: Flow;
  load: ImageLoader;
  children: ReactNode;
}) {
  const [images, setImages] = useState<Record<string, { asset: Asset; src: string }>>();
  const [loadedKey, setLoadedKey] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const required = [...requiredAssetIds(flow)].sort();
  const key = JSON.stringify([required, assets]);
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    setImages(undefined);
    setError('');
    void (async () => {
      const loaded: Record<string, { asset: Asset; src: string }> = {};
      for (const id of required) {
        const asset = assets.find((a) => a.id === id);
        if (!asset || flow.languages.some((l) => !asset.alt_text[l]?.trim()))
          throw new Error('Frozen image or reviewed alt text is missing.');
        const blob = await verifyImage(await load(asset), asset);
        if (!alive) return;
        const src = URL.createObjectURL(blob);
        urls.push(src);
        loaded[id] = { asset, src };
      }
      if (alive) {
        setImages(loaded);
        setLoadedKey(key);
      }
    })().catch((e) => {
      if (alive) setError(e instanceof Error ? e.message : 'Cannot prepare frozen stimuli.');
    });
    return () => {
      alive = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [key, retry, load]);
  if (!required.length) return <>{children}</>;
  if (error)
    return (
      <div className="ui-stack">
        <p role="alert">{error}</p>
        <Button onClick={() => setRetry((n) => n + 1)}>Retry stimulus preflight</Button>
      </div>
    );
  if (!images || loadedKey !== key)
    return (
      <p role="status" aria-busy="true">
        Verifying frozen stimuli…
      </p>
    );
  return <Images.Provider value={images}>{children}</Images.Provider>;
}
export function NodeImages({ ids, language }: { ids: string[]; language: string }) {
  const images = useContext(Images);
  return (
    <div className="ui-stack">
      {ids.map((id) => {
        const image = images[id];
        return image ? (
          <ImageStimulus
            key={id}
            src={image.src}
            alt={image.asset.alt_text[language]}
            width={image.asset.width}
            height={image.asset.height}
          />
        ) : (
          <p key={id} role="alert">
            Image preflight is required before this task.
          </p>
        );
      })}
    </div>
  );
}
