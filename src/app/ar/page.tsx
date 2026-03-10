'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { ARViewer } from '@/components/ARViewer';
import { ControlPanel } from '@/components/ControlPanel';
import type { MeshItem, ModelSize } from '@/types/mesh';

function ARViewerPageContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code')?.trim()?.toUpperCase();
  const [meshItems, setMeshItems] = useState<MeshItem[]>([]);
  const [modelSize, setModelSize] = useState<ModelSize | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [modelGeoLocation, setModelGeoLocation] = useState<{ lat: number; lon: number; alt: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modelReady, setModelReady] = useState(!code || code.length !== 4);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!code || code.length !== 4) {
      setModelUrl(null);
      setModelGeoLocation(null);
      setModelReady(true);
      return;
    }
    setModelReady(false);
    setLoadError(null);
    let cancelled = false;
    (async () => {
      try {
        const [modelRes, metaRes] = await Promise.all([
          fetch(`/api/ar/model?code=${encodeURIComponent(code)}`),
          fetch(`/api/ar/model/meta?code=${encodeURIComponent(code)}`),
        ]);
        if (!modelRes.ok) {
          const data = await modelRes.json().catch(() => ({}));
          if (!cancelled) setLoadError(data.error ?? '모델을 불러올 수 없습니다.');
          if (!cancelled) setModelReady(true);
          return;
        }
        const blob = await modelRes.blob();
        if (cancelled) return;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setModelUrl(url);
        let geo: { lat: number; lon: number; alt: number } | null = null;
        if (metaRes.ok) {
          const meta = await metaRes.json();
          if (meta.lat != null && meta.lon != null) {
            geo = { lat: meta.lat, lon: meta.lon, alt: meta.alt ?? 0 };
          }
        }
        if (!cancelled) {
          const qr = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('qrScannedCoords') : null;
          if (qr) {
            try {
              const parsed = JSON.parse(qr) as { lat?: number; lon?: number; alt?: number };
              if (typeof parsed.lat === 'number' && typeof parsed.lon === 'number') {
                geo = { lat: parsed.lat, lon: parsed.lon, alt: typeof parsed.alt === 'number' ? parsed.alt : 0 };
              }
            } catch {
              // ignore
            }
          }
          setModelGeoLocation(geo);
        }
        if (!cancelled) setModelReady(true);
      } catch {
        if (!cancelled) setLoadError('모델을 불러올 수 없습니다.');
        if (!cancelled) setModelReady(true);
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [code]);

  return (
    <main className="relative flex min-h-0 flex-1 w-full">
      {!modelReady ? (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4"
          style={{ background: 'linear-gradient(180deg, #281e5a 0%, #50288c 100%)' }}
        >
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
          <p className="text-white/90">모델 불러오는 중…</p>
        </div>
      ) : (
        <>
          <ARViewer
            meshItems={meshItems}
            setMeshItems={setMeshItems}
            setModelSize={setModelSize}
            initialModelUrl={modelUrl}
            modelGeoLocation={modelGeoLocation}
            arCode={code ?? undefined}
          />
          <ControlPanel meshItems={meshItems} setMeshItems={setMeshItems} />
        </>
      )}
      {code && loadError && (
        <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded bg-red-900/90 px-4 py-2 text-sm text-white">
          {loadError}
        </div>
      )}
    </main>
  );
}

export default function ARViewerPage() {
  return (
    <Suspense
      fallback={
        <main className="relative flex min-h-0 flex-1 w-full">
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4"
            style={{ background: 'linear-gradient(180deg, #281e5a 0%, #50288c 100%)' }}
          >
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
            <p className="text-white/90">모델 불러오는 중…</p>
          </div>
        </main>
      }
    >
      <ARViewerPageContent />
    </Suspense>
  );
}
