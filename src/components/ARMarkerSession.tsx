'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { THREEx } from '@ar-js-org/ar.js-threejs';
import type { MeshItem } from '@/types/mesh';

function setMeshMaterialOpacity(mesh: THREE.Mesh, opacity: number): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((m) => {
    m.transparent = true;
    m.opacity = opacity;
  });
}

function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function getViewportSize() {
  const w = typeof window !== 'undefined' ? window.innerWidth : 640;
  const h = typeof window !== 'undefined' ? window.innerHeight : 480;
  const isPortrait = h > w;
  const mobile = isMobile();
  const maxSrc = mobile ? 256 : 640;
  return {
    width: isPortrait ? Math.min(maxSrc, w) : Math.min(maxSrc, w),
    height: isPortrait ? Math.min(maxSrc, h) : Math.min(maxSrc, h),
    fullWidth: w,
    fullHeight: h,
  };
}

export interface ARMarkerSessionProps {
  /** GLB 모델 URL (blob 또는 API URL) */
  modelUrl: string | null;
  /** 닫기(Location OFF) 콜백 */
  onClose: () => void;
  /** 메시별 투명도 (optional) */
  meshItems?: MeshItem[];
}

/** AR.js 마커 트래킹 세션 - 마커 위에 GLB 모델 배치 */
export function ARMarkerSession({ modelUrl, onClose, meshItems = [] }: ARMarkerSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('초기화 중…');
  const [retryKey, setRetryKey] = useState(0);
  const [fixingLocation, setFixingLocation] = useState(false);
  const meshByIdRef = useRef<Map<string, THREE.Mesh>>(new Map());

  const insecureContext = typeof window !== 'undefined' && !window.isSecureContext;

  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return;
    if (!modelUrl) {
      setStatus('모델이 없습니다.');
      return;
    }

    if (!window.isSecureContext) {
      setError('카메라는 HTTPS에서만 사용할 수 있습니다.');
      return;
    }

    let cancelled = false;
    const container = containerRef.current;
    THREEx.ArToolkitContext.baseURL = '/markers/';
    const vp = getViewportSize();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isMobile(),
      alpha: false,
      powerPreference: isMobile() ? 'low-power' : 'default',
      failIfMajorPerformanceCaveat: false,
    });
    renderer.setClearColor(0x000000, 1);
    renderer.setSize(vp.fullWidth, vp.fullHeight);
    const canvasEl = renderer.domElement;
    canvasEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:0;';
    container.appendChild(canvasEl);

    let contextLost = false;
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
      setError('그래픽 리소스가 부족합니다. 닫기 후 다른 탭을 닫고 다시 시도해 주세요.');
    };
    canvasEl.addEventListener('webglcontextlost', handleContextLost);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    scene.add(camera);

    let videoBackgroundMesh: THREE.Mesh | null = null;
    let videoTexture: THREE.VideoTexture | null = null;
    let arToolkitSource: InstanceType<typeof THREEx.ArToolkitSource> | null = null;
    let videoEl: HTMLVideoElement | null = null;
    let arToolkitContext: InstanceType<typeof THREEx.ArToolkitContext> | null = null;
    const onRenderFcts: Array<(delta?: number) => void> = [];
    let modelGroup: THREE.Group | null = null;
    let videoCheckTimeout: ReturnType<typeof setTimeout> | null = null;
    let animId = 0;

    const markerGroup = new THREE.Group();
    scene.add(markerGroup);
    let hasMarkerVisible = false;

    function doResize() {
      if (!arToolkitSource) return;
      const { fullWidth, fullHeight } = getViewportSize();
      renderer.setSize(fullWidth, fullHeight);
      arToolkitSource.onResizeElement();
      arToolkitSource.copyElementSizeTo(renderer.domElement);
      if (arToolkitContext?.arController?.canvas) {
        arToolkitSource.copyElementSizeTo(arToolkitContext.arController.canvas);
      }
    }

    arToolkitSource = new THREEx.ArToolkitSource({
      sourceType: 'webcam',
      sourceWidth: vp.width,
      sourceHeight: vp.height,
      displayWidth: vp.fullWidth,
      displayHeight: vp.fullHeight,
    });

    arToolkitSource.init(
      () => {
        if (cancelled) return;
        setError(null);
        setStatus('카메라 준비됨, 마커 인식 대기 중…');
        videoEl = arToolkitSource!.domElement as HTMLVideoElement;
        videoEl.setAttribute('playsinline', 'true');
        videoEl.setAttribute('webkit-playsinline', 'true');
        videoEl.setAttribute('muted', 'true');
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.autoplay = true;
        videoEl.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';

        videoTexture = new THREE.VideoTexture(videoEl);
        videoTexture.minFilter = THREE.LinearFilter;
        videoTexture.magFilter = THREE.LinearFilter;
        const aspect = vp.fullWidth / vp.fullHeight;
        const bgGeom = new THREE.PlaneGeometry(2 * aspect, 2);
        const bgMat = new THREE.MeshBasicMaterial({
          map: videoTexture,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: false,
        });
        videoBackgroundMesh = new THREE.Mesh(bgGeom, bgMat);
        videoBackgroundMesh.position.z = -1;
        videoBackgroundMesh.rotation.y = Math.PI;
        videoBackgroundMesh.frustumCulled = false;
        videoBackgroundMesh.renderOrder = -1;
        scene.add(videoBackgroundMesh);

        let arContextInited = false;
        const onVideoReady = () => {
          if (cancelled) return;
          videoEl!.play().catch(() => {});
          doResize();
          if (!arContextInited) {
            arContextInited = true;
            if (isMobile()) {
              setStatus('AR 초기화 준비 중…');
              setTimeout(() => {
                if (cancelled) return;
                initARContext();
              }, 800);
            } else {
              initARContext();
            }
          }
        };
        videoEl.play().catch(() => {});
        videoEl.addEventListener('canplay', onVideoReady, { once: true });
        videoEl.addEventListener('loadeddata', onVideoReady, { once: true });
        if (videoEl.readyState >= 2) {
          onVideoReady();
        } else {
          setTimeout(() => {
            if (!cancelled && videoEl) {
              if (videoEl.readyState >= 2) onVideoReady();
              else doResize();
            }
          }, 300);
        }
        videoCheckTimeout = setTimeout(() => {
          if (cancelled || !videoEl) return;
          if (videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
            setError('카메라 영상이 표시되지 않습니다. 브라우저 설정에서 카메라 권한을 허용했는지 확인하세요.');
          }
        }, 3000);
      },
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Permission') || msg.includes('NotAllowed') || msg.includes('denied')) {
          setError('카메라 권한이 거부되었습니다. 브라우저 설정에서 카메라를 허용해 주세요.');
        } else if (msg.includes('NotFound') || msg.includes('not found')) {
          setError('카메라를 찾을 수 없습니다.');
        } else if (!window.isSecureContext) {
          setError('자체 서명 인증서는 카메라를 차단할 수 있습니다. mkcert로 로컬 인증서를 신뢰해 주세요.');
        } else {
          setError('카메라 접근에 실패했습니다. HTTPS와 카메라 권한을 확인해 주세요.');
        }
        console.error('ArToolkitSource init error:', err);
      }
    );

    function initARContext() {
      if (!arToolkitSource) return;

      arToolkitContext = new THREEx.ArToolkitContext({
        cameraParametersUrl: THREEx.ArToolkitContext.baseURL + 'camera_para.dat',
        detectionMode: 'mono',
      });

      const ctx = arToolkitContext;
      ctx.init(() => {
        camera.projectionMatrix.copy(ctx.getProjectionMatrix());
        const orient = arToolkitSource!.domElement.videoWidth > arToolkitSource!.domElement.videoHeight ? 'landscape' : 'portrait';
        (ctx as { arController?: { orientatio?: string; options?: { orientation?: string } } }).arController!.orientatio = orient;
        (ctx as { arController?: { orientatio?: string; options?: { orientation?: string } } }).arController!.options!.orientation = orient;

        new THREEx.ArMarkerControls(ctx, markerGroup, {
          type: 'pattern',
          patternUrl: THREEx.ArToolkitContext.baseURL + 'pattern-test.patt',
          changeMatrixMode: 'modelViewMatrix',
        });

        markerGroup.visible = false;
        setStatus('마커를 카메라에 비춰 주세요');
      });
    }


    // GLB 로드
    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        markerGroup.add(model);
        modelGroup = model;

        meshByIdRef.current.clear();
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            setMeshMaterialOpacity(child, 1);
            meshByIdRef.current.set(child.uuid, child);
          }
        });
      },
      undefined,
      (err: unknown) => {
        setError(err instanceof Error ? err.message : '모델 로드 실패');
        console.error('GLB load error:', err);
      }
    );

    const mobileDevice = isMobile();
    let frameCount = 0;
    onRenderFcts.push(() => {
      if (!arToolkitContext || !arToolkitSource?.ready) return;
      if (mobileDevice) {
        frameCount = (frameCount + 1) % 2;
        if (frameCount === 1) return;
      }
      try {
        arToolkitContext.update(arToolkitSource.domElement);
      } catch (e) {
        if (!contextLost) {
          contextLost = true;
          setError('마커 인식 처리 중 오류가 발생했습니다. 닫기 후 다시 시도해 주세요.');
        }
        return;
      }
      markerGroup.visible = camera.visible;
      // 마커가 한 번이라도 인식되었는지 플래그 업데이트
      if (!hasMarkerVisible && markerGroup.visible) {
        hasMarkerVisible = true;
        if (!error) {
          setStatus('마커 인식됨. 이 위치를 기준으로 AR을 고정할 수 있습니다.');
        }
      }
    });

    onRenderFcts.push(() => {
      if (contextLost) return;
      if (videoTexture) videoTexture.needsUpdate = true;
      try {
        renderer.render(scene, camera);
      } catch (e) {
        contextLost = true;
        setError('렌더링 오류가 발생했습니다. 닫기 후 다시 시도해 주세요.');
      }
    });

    let lastTime = performance.now();
    function animate(now: number) {
      animId = requestAnimationFrame(animate);
      if (contextLost || cancelled) return;
      const delta = Math.min(0.2, (now - lastTime) / 1000);
      lastTime = now;
      try {
        onRenderFcts.forEach((fn) => fn(delta));
      } catch (e) {
        contextLost = true;
        setError('렌더링 오류가 발생했습니다. 닫기 후 다시 시도해 주세요.');
      }
    }
    animId = requestAnimationFrame(animate);

    window.addEventListener('resize', doResize);

    return () => {
      contextLost = true;
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', doResize);
      canvasEl.removeEventListener('webglcontextlost', handleContextLost);
      if (videoCheckTimeout) clearTimeout(videoCheckTimeout);
      videoTexture?.dispose();
      videoBackgroundMesh?.geometry?.dispose();
      (videoBackgroundMesh?.material as THREE.Material)?.dispose();
      renderer.dispose();
      canvasEl.remove();
      videoEl?.remove();
      if (arToolkitSource?.domElement?.srcObject) {
        (arToolkitSource.domElement.srcObject as MediaStream)?.getTracks?.()?.forEach((t) => t.stop());
      }
      if (modelGroup) {
        modelGroup.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry) {
            child.geometry.dispose();
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => m.dispose?.());
          }
        });
      }
    };
  }, [modelUrl, retryKey]);

  const handleFixLocation = () => {
    if (!window.isSecureContext) {
      setError('위치를 고정하려면 HTTPS 환경이 필요합니다.');
      return;
    }
    if (!navigator.geolocation) {
      setError('이 브라우저는 위치 서비스를 지원하지 않습니다.');
      return;
    }
    setFixingLocation(true);
    setStatus('현재 위치 측정 중…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const alt = pos.coords.altitude ?? 0;
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(
              'qrScannedCoords',
              JSON.stringify({ lat, lon, alt })
            );
          }
          setStatus('위치가 고정되었습니다. AR 화면에서 Location ON으로 자유 관찰을 시작하세요.');
          setFixingLocation(false);
          // 마커 모드 종료하고 /ar 화면으로 돌아가기
          onClose();
        } catch (e) {
          console.error('Fix location error:', e);
          setError('위치를 저장하는 중 오류가 발생했습니다.');
          setFixingLocation(false);
        }
      },
      (err) => {
        setError(err.message || '현재 위치를 가져올 수 없습니다.');
        setFixingLocation(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  };

  // meshItems 변경 시 투명도 적용
  useEffect(() => {
    meshItems.forEach((item) => {
      const mesh = meshByIdRef.current.get(item.id);
      if (mesh) setMeshMaterialOpacity(mesh, item.opacity);
    });
  }, [meshItems]);

  // HTTPS 아님 → 화면 중앙에 큰 안내 (검은 화면만 보이는 문제 해결)
  if (insecureContext || error === '카메라는 HTTPS에서만 사용할 수 있습니다.') {
    return (
      <div
        className="fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-4 p-6"
        style={{ background: '#1a1a2e', width: '100vw', height: '100dvh' } as React.CSSProperties}
      >
        <p className="text-center text-lg font-medium text-white">
          카메라를 사용하려면 HTTPS가 필요합니다
        </p>
        <p className="max-w-sm text-center text-sm text-white/70">
          http:// 대신 https:// 로 접속해 주세요.
          <br />
          (예: https://192.168.200.188:3000)
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-white/80 bg-white/10 px-6 py-3 text-white"
        >
          닫기
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[2000] flex flex-col overflow-hidden"
      style={{
        background: '#000',
        width: '100vw',
        height: '100dvh',
        minHeight: '-webkit-fill-available',
        position: 'fixed',
      } as React.CSSProperties}
    >
      <div className="absolute left-5 top-5 z-10 flex flex-col gap-1">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/80 bg-black/50 px-4 py-2 text-sm text-white opacity-90 outline-none transition-opacity hover:opacity-100"
            aria-label="Location OFF"
          >
            Location OFF
          </button>
          <button
            type="button"
            onClick={handleFixLocation}
            disabled={fixingLocation}
            className="rounded border border-emerald-300/80 bg-emerald-500/80 px-4 py-2 text-xs text-white opacity-95 outline-none transition-opacity hover:opacity-100 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {fixingLocation ? '위치 고정 중…' : '이 위치로 AR 고정'}
          </button>
        </div>
        {(error || status) && (
          <div className="flex flex-col gap-2">
            <p className="max-w-[220px] rounded bg-black/60 px-2 py-1 text-xs text-white">
              {error || status}
            </p>
            {error && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStatus('다시 시도 중…');
                  setRetryKey((k) => k + 1);
                }}
                className="rounded border border-white/60 bg-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/30"
              >
                다시 시도
              </button>
            )}
          </div>
        )}
      </div>
      {!modelUrl && (
        <div className="flex flex-1 items-center justify-center text-white/80">
          모델을 먼저 불러와 주세요.
        </div>
      )}
    </div>
  );
}
