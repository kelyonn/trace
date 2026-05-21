import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type ThreePreviewProps = {
  metric: number;
};

const ThreePreview = ({ metric }: ThreePreviewProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let renderer: THREE.WebGLRenderer | null = null;

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFallback(true);
      return;
    }

    const width = containerRef.current.clientWidth;
    const height = 260;
    renderer.setSize(width, height);
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f8f3ec");

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(3.2, 2.4, 4.2);

    const ambientLight = new THREE.AmbientLight("#ffffff", 0.8);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight("#ffd7c3", 0.9);
    keyLight.position.set(2, 4, 3);
    scene.add(keyLight);

    const group = new THREE.Group();
    scene.add(group);

    const cubeCount = 6;
    const intensity = Math.max(1, Math.min(12, metric));
    for (let i = 0; i < cubeCount; i += 1) {
      const heightScale = 0.4 + (intensity / 12) * (i + 1) * 0.08;
      const geometry = new THREE.BoxGeometry(0.6, heightScale, 0.6);
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(`hsl(${18 + i * 10}, 85%, 60%)`),
        roughness: 0.35,
        metalness: 0.1
      });
      const cube = new THREE.Mesh(geometry, material);
      cube.position.set(-1.6 + i * 0.65, heightScale / 2, 0);
      group.add(cube);
    }

    let frameId = 0;
    const start = performance.now();
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const elapsed = performance.now() - start;
      if (elapsed > 2000 && renderer) {
        const fps = Math.round((frameId / elapsed) * 1000);
        if (fps < 20) {
          setFallback(true);
          return;
        }
      }
      group.rotation.y += 0.003;
      renderer?.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!containerRef.current || !renderer) {
        return;
      }
      const nextWidth = containerRef.current.clientWidth;
      camera.aspect = nextWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, height);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      renderer?.dispose();
      containerRef.current?.replaceChildren();
    };
  }, [metric]);

  if (fallback) {
    return (
      <div className="fallback-card">
        <p className="status-title">2-D fallback</p>
        <p className="muted">3-D rendering is disabled for this device.</p>
        <div className="fallback-metric">
          <span>{metric}</span>
          <span className="muted">rows loaded</span>
        </div>
      </div>
    );
  }

  return <div className="canvas-shell" ref={containerRef} />;
};

export default ThreePreview;
