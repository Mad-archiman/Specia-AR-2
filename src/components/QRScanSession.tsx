'use client';

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export interface ParsedCoords {
  lat: number;
  lon: number;
  alt?: number;
}

function parseCoordsFromQR(text: string): ParsedCoords | null {
  try {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
      const obj = JSON.parse(trimmed) as { lat?: number; lon?: number; alt?: number };
      if (typeof obj.lat === 'number' && typeof obj.lon === 'number') {
        return {
          lat: obj.lat,
          lon: obj.lon,
          alt: typeof obj.alt === 'number' ? obj.alt : 0,
        };
      }
    }
    const match = trimmed.match(/lat[=:]?\s*([-\d.]+)[,\s]+lon[=:]?\s*([-\d.]+)(?:[,\s]+alt[=:]?\s*([-\d.]+))?/i);
    if (match) {
      return {
        lat: parseFloat(match[1]),
        lon: parseFloat(match[2]),
        alt: match[3] ? parseFloat(match[3]) : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export interface QRScanSessionProps {
  onClose: () => void;
  onScanSuccess?: (coords: ParsedCoords) => void;
  /** QR 좌표를 모델 원점(0,0,0)으로 설정 시 호출. LOCATION SET 버튼 클릭 시 호출됨 */
  onLocationSet?: (coords: ParsedCoords) => void;
}

/** QR 코드 스캔 - 좌표(JSON) 포함 시 성공 */
export function QRScanSession({ onClose, onScanSuccess, onLocationSet }: QRScanSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('카메라 준비 중…');
  const [scanned, setScanned] = useState<ParsedCoords | null>(null);

  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return;
    if (!window.isSecureContext) {
      setError('카메라는 HTTPS에서만 사용할 수 있습니다.');
      return;
    }

    const id = 'qr-reader-' + Math.random().toString(36).slice(2);
    const div = document.createElement('div');
    div.id = id;
    div.style.width = '100%';
    div.style.maxWidth = '100%';
    containerRef.current.appendChild(div);

    const scanner = new Html5Qrcode(id);
    scannerRef.current = scanner;

    const onSuccess = (decodedText: string) => {
      const coords = parseCoordsFromQR(decodedText);
      if (coords) {
        startedRef.current = false;
        scanner.stop().catch(() => {});
        setScanned(coords);
        setStatus('좌표를 확인했습니다');
        onScanSuccess?.(coords);
      }
    };

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 5, qrbox: { width: 250, height: 250 } },
        onSuccess,
        () => {}
      )
      .then(() => {
        startedRef.current = true;
        setError(null);
        setStatus('QR 코드를 카메라에 비춰 주세요');
      })
      .catch((err) => {
        const msg = String(err).toLowerCase();
        if (msg.includes('not allowed') || msg.includes('permission') || msg.includes('denied')) {
          setError('카메라 권한이 거부되었습니다.');
        } else if (msg.includes('not found') || msg.includes('no camera')) {
          setError('카메라를 찾을 수 없습니다.');
        } else {
          setError('카메라 접근에 실패했습니다.');
        }
        console.error('Html5Qrcode start error:', err);
      });

    return () => {
      const cleanup = () => {
        try {
          const result = scanner.clear() as unknown;
          if (result && typeof (result as Promise<unknown>).catch === 'function') {
            (result as Promise<unknown>).catch(() => {});
          }
        } catch {
          // clear()가 void 반환 시 무시
        }
      };
      if (startedRef.current) {
        scanner.stop().then(cleanup).catch(cleanup);
      } else {
        cleanup();
      }
      scannerRef.current = null;
      startedRef.current = false;
      div.remove();
    };
  }, [onScanSuccess]);

  return (
    <div
      className="fixed inset-0 z-[2000] flex flex-col overflow-hidden bg-black"
      style={{ width: '100vw', height: '100dvh' }}
    >
      <div className="absolute left-4 top-4 right-4 z-10 flex flex-col gap-2">
        <button
          type="button"
          onClick={onClose}
          className="self-start rounded border border-white/80 bg-black/50 px-4 py-2 text-sm text-white"
        >
          닫기
        </button>
        {(error || status) && (
          <p className="rounded bg-black/60 px-3 py-2 text-sm text-white">{error || status}</p>
        )}
        <p className="rounded bg-black/50 px-3 py-1.5 text-xs text-white/80">
          QR 형식: {`{"lat":위도,"lon":경도,"alt":고도}`}
        </p>
        {scanned && (
          <div className="rounded bg-green-900/80 px-3 py-2 text-sm text-white">
            lat: {scanned.lat.toFixed(6)}, lon: {scanned.lon.toFixed(6)}
            {scanned.alt != null && `, alt: ${scanned.alt}`}
          </div>
        )}
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" />
      {scanned && onLocationSet && (
        <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-white/20 bg-black/80 p-4 safe-area-inset-bottom">
          <button
            type="button"
            onClick={() => onLocationSet(scanned)}
            className="w-full rounded-lg border-2 border-emerald-500 bg-emerald-600/90 py-4 font-semibold text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700"
          >
            LOCATION SET
          </button>
          <p className="mt-2 text-center text-xs text-white/70">
            이 위치를 GLB 모델 원점(0,0,0)으로 설정합니다
          </p>
        </div>
      )}
    </div>
  );
}
