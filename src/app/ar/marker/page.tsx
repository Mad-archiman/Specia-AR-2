'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { QRScanSession } from '@/components/QRScanSession';
import { ARMarkerSession } from '@/components/ARMarkerSession';
import { ARMarkerSessionErrorBoundary } from '@/components/ARMarkerSessionErrorBoundary';

function ARMarkerPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get('code')?.trim()?.toUpperCase();
  const mode = searchParams.get('mode'); // 'qr' = 좌표 스캔, 없으면 code 있을 때 마커 트래킹
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!(code && code.length === 4 && !mode));
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!code || code.length !== 4 || mode === 'qr') {
      setModelUrl(null);
      setLoading(false);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ar/model?code=${encodeURIComponent(code)}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (!cancelled) setLoadError(data.error ?? '모델을 불러올 수 없습니다.');
          if (!cancelled) setLoading(false);
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        if (!cancelled) {
          setModelUrl(url);
          setLoadError(null);
        } else {
          URL.revokeObjectURL(url);
        }
      } catch {
        if (!cancelled) {
          setLoadError('모델을 불러올 수 없습니다.');
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [code, mode]);

  const handleClose = () => {
    router.push(code ? `/ar?code=${code}` : '/ar');
  };

  const handleScanSuccess = (_coords: { lat: number; lon: number; alt?: number }) => {
    // 스캔 성공 시 LOCATION SET 버튼 표시. 실제 저장/이동은 handleLocationSet에서 수행
  };

  const handleLocationSet = (coords: { lat: number; lon: number; alt?: number }) => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('qrScannedCoords', JSON.stringify(coords));
    }
    router.push(code ? `/ar?code=${code}` : '/ar');
  };

  // code 있고 mode !== 'qr' → AR.js 마커 트래킹 (모델 로드 후)
  if (code && code.length === 4 && mode !== 'qr') {
    if (loading) {
      return (
        <main
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4"
          style={{ background: 'linear-gradient(180deg, #281e5a 0%, #50288c 100%)' }}
        >
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
          <p className="text-white/90">모델 불러오는 중…</p>
        </main>
      );
    }
    if (loadError) {
      return (
        <main
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-4"
          style={{ background: 'linear-gradient(180deg, #281e5a 0%, #50288c 100%)' }}
        >
          <p className="text-center text-white/90">{loadError}</p>
          <button
            type="button"
            onClick={handleClose}
            className="rounded border border-white/80 bg-black/50 px-4 py-2 text-sm text-white"
          >
            닫기
          </button>
        </main>
      );
    }
    if (modelUrl) {
      return (
        <ARMarkerSessionErrorBoundary onClose={handleClose}>
          <ARMarkerSession modelUrl={modelUrl} onClose={handleClose} />
        </ARMarkerSessionErrorBoundary>
      );
    }
  }

  // QR 좌표 스캔 (mode=qr 또는 code 없음)
  return (
    <QRScanSession
      onClose={handleClose}
      onScanSuccess={handleScanSuccess}
      onLocationSet={handleLocationSet}
    />
  );
}

export default function ARMarkerPage() {
  return (
    <Suspense
      fallback={
        <main
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4"
          style={{ background: 'linear-gradient(180deg, #281e5a 0%, #50288c 100%)' }}
        >
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
          <p className="text-white/90">로딩 중…</p>
        </main>
      }
    >
      <ARMarkerPageContent />
    </Suspense>
  );
}
