'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { THREEx } from '@ar-js-org/ar.js-threejs';

/** AR.js 마커 트래킹 POC 테스트 페이지
 * - Hiro 마커를 카메라로 비추면 3D 큐브가 마커 위에 표시됨
 * - /markers/hiro-marker.png 를 출력해서 테스트
 */
export default function MarkerTestPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('초기화 중…');

  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return;

    const container = containerRef.current;
    THREEx.ArToolkitContext.baseURL = '/markers/';

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(new THREE.Color('lightgrey'), 0);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    scene.add(camera);

    let arToolkitSource: InstanceType<typeof THREEx.ArToolkitSource> | null = null;
    let videoEl: HTMLVideoElement | null = null;
    let arToolkitContext: InstanceType<typeof THREEx.ArToolkitContext> | null = null;
    let arMarkerControls: InstanceType<typeof THREEx.ArMarkerControls> | null = null;

    const onRenderFcts: Array<(delta?: number) => void> = [];

    arToolkitSource = new THREEx.ArToolkitSource({
      sourceType: 'webcam',
      sourceWidth: Math.min(640, window.innerWidth),
      sourceHeight: Math.min(480, window.innerHeight),
    });

    arToolkitSource.init(
      () => {
        setStatus('카메라 준비됨, 마커 인식 대기 중…');
        videoEl = arToolkitSource!.domElement as HTMLVideoElement;
        videoEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:0;';
        container.insertBefore(videoEl, renderer.domElement);
        videoEl.addEventListener('canplay', () => initARContext());
        if (videoEl.readyState >= 2) initARContext();
      },
      (err: unknown) => {
        setError('카메라 접근에 실패했습니다. 권한을 확인해 주세요.');
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
      arToolkitContext.init(() => {
        camera.projectionMatrix.copy(ctx.getProjectionMatrix());
        const orient = arToolkitSource!.domElement.videoWidth > arToolkitSource!.domElement.videoHeight ? 'landscape' : 'portrait';
        (ctx as { arController?: { orientatio?: string; options?: { orientation?: string } } }).arController!.orientatio = orient;
        (ctx as { arController?: { orientatio?: string; options?: { orientation?: string } } }).arController!.options!.orientation = orient;

        arMarkerControls = new THREEx.ArMarkerControls(ctx, camera, {
          type: 'pattern',
          patternUrl: THREEx.ArToolkitContext.baseURL + 'pattern-specia.patt',
          changeMatrixMode: 'cameraTransformMatrix',
        });

        scene.visible = false;
        setStatus('마커를 카메라에 비춰 주세요');
      });
    }

    renderer.domElement.style.zIndex = '1';

    // 큐브 - 마커의 (0,0,0) 원점에 배치됨
    const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const material = new THREE.MeshNormalMaterial({ transparent: true, opacity: 0.9 });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.y = 0.25;
    scene.add(cube);

    onRenderFcts.push(() => {
      if (!arToolkitContext || !arToolkitSource?.ready) return;
      arToolkitContext.update(arToolkitSource.domElement);
      scene.visible = camera.visible;
    });

    onRenderFcts.push((delta = 0.016) => {
      cube.rotation.y += Math.PI * 0.5 * delta;
    });

    onRenderFcts.push(() => {
      renderer.render(scene, camera);
    });

    let lastTime = performance.now();
    function animate(now: number) {
      requestAnimationFrame(animate);
      const delta = Math.min(0.2, (now - lastTime) / 1000);
      lastTime = now;
      onRenderFcts.forEach((fn) => fn(delta));
    }
    requestAnimationFrame(animate);

    const onResize = () => {
      if (!arToolkitSource) return;
      renderer.setSize(window.innerWidth, window.innerHeight);
      arToolkitSource.onResizeElement();
      arToolkitSource.copyElementSizeTo(renderer.domElement);
      if (arToolkitContext?.arController?.canvas) {
        arToolkitSource.copyElementSizeTo(arToolkitContext.arController.canvas);
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.domElement.remove();
      videoEl?.remove();
      if (arToolkitSource?.domElement?.srcObject) {
        (arToolkitSource.domElement.srcObject as MediaStream)?.getTracks?.()?.forEach((t) => t.stop());
      }
    };
  }, []);

  return (
    <main
      ref={containerRef}
      className="relative flex min-h-0 w-full flex-1 flex-col items-center justify-center overflow-hidden"
      style={{ minHeight: '60vh' }}
    >
      <div
        className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-black/70 px-4 py-2 text-center text-sm text-white"
        style={{ maxWidth: '90%' }}
      >
        {error || status}
      </div>
      <a
        href="https://ar-js-org.github.io/AR.js/three.js/examples/marker-training/examples/generator.html"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-4 top-4 z-20 rounded bg-white/90 px-2 py-1 text-xs text-gray-800 hover:bg-white"
      >
        마커 생성/출력
      </a>
    </main>
  );
}
