import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Column } from "@trace/shared-types";
import { pivotRows, type PivotShape } from "./pivot";

type Props = {
  columns: Column[];
  rows: unknown[][];
  onDrill?: (rowLabel: string, colLabel: string) => void;
};

function heatColor(t: number): THREE.Color {
  // Blue (cold) → Orange (hot) heatmap
  const r = t;
  const g = 0.3 * (1 - t) + 0.4 * t;
  const b = 0.8 * (1 - t);
  return new THREE.Color(r, g, b);
}

function FallbackHeatmap({ pivot }: { pivot: PivotShape }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const { rowLabels, colLabels, values, measureName, minValue, maxValue } = pivot;

    // Build a Vega-Lite spec
    const data = rowLabels.flatMap((r, ri) =>
      colLabels.map((c, ci) => ({
        row: r,
        col: c,
        value: values[ri][ci]
      }))
    );

    const spec = {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      data: { values: data },
      mark: "rect",
      encoding: {
        x: { field: "col", type: "ordinal", title: pivot.colDim },
        y: { field: "row", type: "ordinal", title: pivot.rowDim },
        color: {
          field: "value",
          type: "quantitative",
          title: measureName,
          scale: { scheme: "oranges", domain: [minValue, maxValue] }
        },
        tooltip: [
          { field: "row", title: pivot.rowDim },
          { field: "col", title: pivot.colDim },
          { field: "value", title: measureName }
        ]
      },
      width: "container",
      height: 240
    };

    import("vega-embed").then(({ default: embed }) => {
      if (containerRef.current) {
        embed(containerRef.current, spec as Parameters<typeof embed>[1], { actions: false }).catch(
          () => {}
        );
      }
    });
  }, [pivot]);

  return <div ref={containerRef} style={{ width: "100%", minHeight: 260 }} />;
}

const CubeViewer = ({ columns, rows, onDrill }: Props) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fallback, setFallback] = useState(false);
  const [pivot, setPivot] = useState<PivotShape | null>(null);

  useEffect(() => {
    const p = pivotRows(columns, rows);
    setPivot(p);
    setFallback(!p);
  }, [columns, rows]);

  const handleClick = useCallback(
    (e: MouseEvent, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, meshes: THREE.Mesh[], labels: { row: string; col: string }[]) => {
      if (!containerRef.current || !onDrill) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(meshes);
      if (hits.length > 0) {
        const idx = meshes.indexOf(hits[0].object as THREE.Mesh);
        if (idx >= 0 && labels[idx]) {
          onDrill(labels[idx].row, labels[idx].col);
        }
      }
    },
    [onDrill]
  );

  useEffect(() => {
    if (!containerRef.current || !pivot) return;

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFallback(true);
      return;
    }

    const { rowLabels, colLabels, values, minValue, maxValue } = pivot;
    const width = containerRef.current.clientWidth || 600;
    const height = 320;

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f8f3ec");

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);
    camera.position.set(rowLabels.length * 0.6, 6, colLabels.length * 1.2);
    camera.lookAt(rowLabels.length * 0.3, 0, colLabels.length * 0.3);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    scene.add(new THREE.AmbientLight("#ffffff", 0.7));
    const dirLight = new THREE.DirectionalLight("#fff3e0", 0.9);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    const meshes: THREE.Mesh[] = [];
    const drillLabels: { row: string; col: string }[] = [];
    const range = maxValue - minValue || 1;

    for (let ri = 0; ri < rowLabels.length; ri++) {
      for (let ci = 0; ci < colLabels.length; ci++) {
        const v = values[ri]?.[ci] ?? 0;
        const t = (v - minValue) / range;
        const barHeight = Math.max(0.05, t * 3);
        const geo = new THREE.BoxGeometry(0.8, barHeight, 0.8);
        const mat = new THREE.MeshStandardMaterial({
          color: heatColor(t),
          roughness: 0.4,
          metalness: 0.05
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(ri * 1.1, barHeight / 2, ci * 1.1);
        scene.add(mesh);
        meshes.push(mesh);
        drillLabels.push({ row: rowLabels[ri], col: colLabels[ci] });
      }
    }

    // Click handler for drill-through
    const onClick = (e: MouseEvent) => handleClick(e, renderer!, camera, meshes, drillLabels);
    renderer.domElement.addEventListener("click", onClick);

    let frameId = 0;
    const startTime = performance.now();
    let framesSinceMark = 0;
    let lastFpsMark = startTime;
    let fpsFailed = false;

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      framesSinceMark += 1;
      const now = performance.now();
      const elapsed = now - lastFpsMark;

      if (elapsed >= 2000) {
        const fps = (framesSinceMark / elapsed) * 1000;
        framesSinceMark = 0;
        lastFpsMark = now;
        if (fps < 20 && now - startTime > 3000) {
          fpsFailed = true;
        }
      }

      if (fpsFailed) {
        setFallback(true);
        return;
      }

      controls.update();
      renderer?.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!containerRef.current || !renderer) return;
      const w = containerRef.current.clientWidth;
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      renderer.setSize(w, height);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      renderer?.domElement.removeEventListener("click", onClick);
      cancelAnimationFrame(frameId);
      controls.dispose();
      meshes.forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      renderer?.dispose();
      containerRef.current?.replaceChildren();
    };
  }, [pivot, handleClick]);

  if (!pivot && !fallback) {
    return (
      <div className="fallback-card">
        <p className="status-title">Cube view unavailable</p>
        <p className="muted">
          Run a query returning 3 columns: row dimension, column dimension, and a numeric measure.
          Example: <code>SELECT status, region, SUM(amount) FROM orders JOIN customers … GROUP BY 1, 2</code>
        </p>
      </div>
    );
  }

  if (fallback && pivot) {
    return (
      <div>
        <div className="fallback-card" style={{ marginBottom: 8 }}>
          <p className="status-title">2-D heatmap fallback</p>
          <p className="muted">3-D rendering disabled or FPS too low.</p>
        </div>
        <FallbackHeatmap pivot={pivot} />
      </div>
    );
  }

  return <div className="canvas-shell" ref={containerRef} />;
};

export default CubeViewer;
