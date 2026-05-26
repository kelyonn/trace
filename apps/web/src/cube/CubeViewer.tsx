import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Column } from "@trace/shared-types";
import { detectPivot, type PivotShape } from "./pivot";
import { CUBE_BY_STATUS_REGION } from "../demo-queries";

type Props = {
  columns: Column[];
  rows: unknown[][];
  onDrill?: (rowLabel: string, colLabel: string) => void;
  onRunDemoQuery?: (sql: string) => void;
};

const CANVAS_HEIGHT = 400;
const INSTANCED_THRESHOLD = 200;

function heatColor(t: number): THREE.Color {
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
      height: 320
    };

    import("vega-embed").then(({ default: embed }) => {
      if (containerRef.current) {
        embed(containerRef.current, spec as Parameters<typeof embed>[1], { actions: false }).catch(
          () => {}
        );
      }
    });
  }, [pivot]);

  return <div ref={containerRef} style={{ width: "100%", minHeight: 320 }} />;
}

const CubeViewer = ({ columns, rows, onDrill, onRunDemoQuery }: Props) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [use2d, setUse2d] = useState(false);
  const [pivot, setPivot] = useState<PivotShape | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    setPivot(detectPivot(columns, rows));
    setUse2d(false);
  }, [columns, rows]);

  const handleClick = useCallback(
    (e: MouseEvent, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, meshes: THREE.Object3D[]) => {
      if (!onDrill || !containerRef.current) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(meshes, true);
      if (hits.length > 0) {
        const obj = hits[0].object;
        const row = obj.userData.row as string | undefined;
        const col = obj.userData.col as string | undefined;
        if (row !== undefined && col !== undefined) {
          onDrill(row, col);
        }
      }
    },
    [onDrill]
  );

  useEffect(() => {
    if (!containerRef.current || !pivot || use2d) return;

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setUse2d(true);
      return;
    }

    const { rowLabels, colLabels, values, minValue, maxValue, rowDim, colDim, measureName } = pivot;
    const cellCount = rowLabels.length * colLabels.length;

    const getSize = () => ({
      width: containerRef.current?.clientWidth || 600,
      height: CANVAS_HEIGHT
    });

    let { width, height } = getSize();

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f8f3ec");

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);
    const spanX = Math.max(rowLabels.length * 1.1, 4);
    const spanZ = Math.max(colLabels.length * 1.1, 4);
    camera.position.set(spanX * 0.5, Math.max(spanX, spanZ) * 0.8, spanZ * 1.2);
    camera.lookAt(spanX * 0.4, 0, spanZ * 0.4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(spanX * 0.4, 0, spanZ * 0.4);

    scene.add(new THREE.AmbientLight("#ffffff", 0.75));
    const dirLight = new THREE.DirectionalLight("#fff3e0", 0.95);
    dirLight.position.set(spanX, spanZ * 1.5, spanZ);
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(Math.max(spanX, spanZ) + 2, 10, "#d4c4b0", "#e8ddd0");
    scene.add(gridHelper);

    const range = maxValue - minValue || 1;
    const pickables: THREE.Object3D[] = [];
    const barGeo = new THREE.BoxGeometry(0.85, 1, 0.85);

    const placeBar = (ri: number, ci: number, barHeight: number, t: number) => {
      const mat = new THREE.MeshStandardMaterial({
        color: heatColor(t),
        roughness: 0.35,
        metalness: 0.08
      });
      const mesh = new THREE.Mesh(barGeo, mat);
      mesh.scale.y = barHeight;
      mesh.position.set(ri * 1.1, barHeight / 2, ci * 1.1);
      mesh.userData = { row: rowLabels[ri], col: colLabels[ci], value: values[ri][ci] };
      scene.add(mesh);
      pickables.push(mesh);
    };

    if (cellCount > INSTANCED_THRESHOLD) {
      const dummy = new THREE.Object3D();
      const instanced = new THREE.InstancedMesh(
        barGeo,
        new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.08 }),
        cellCount
      );
      let idx = 0;
      for (let ri = 0; ri < rowLabels.length; ri++) {
        for (let ci = 0; ci < colLabels.length; ci++) {
          const v = values[ri]?.[ci] ?? 0;
          const t = (v - minValue) / range;
          const barHeight = Math.max(0.08, t * 3 + 0.1);
          dummy.position.set(ri * 1.1, barHeight / 2, ci * 1.1);
          dummy.scale.set(1, barHeight, 1);
          dummy.updateMatrix();
          instanced.setMatrixAt(idx, dummy.matrix);
          instanced.setColorAt(idx, heatColor(t));
          idx++;
        }
      }
      instanced.instanceMatrix.needsUpdate = true;
      if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
      scene.add(instanced);
      pickables.push(instanced);

      for (let ri = 0; ri < rowLabels.length; ri++) {
        for (let ci = 0; ci < colLabels.length; ci++) {
          const v = values[ri]?.[ci] ?? 0;
          const t = (v - minValue) / range;
          const barHeight = Math.max(0.08, t * 3 + 0.1);
          const pick = new THREE.Mesh(
            new THREE.BoxGeometry(0.85, barHeight, 0.85),
            new THREE.MeshBasicMaterial({ visible: false })
          );
          pick.position.set(ri * 1.1, barHeight / 2, ci * 1.1);
          pick.userData = { row: rowLabels[ri], col: colLabels[ci], value: v };
          scene.add(pick);
          pickables.push(pick);
        }
      }
    } else {
      for (let ri = 0; ri < rowLabels.length; ri++) {
        for (let ci = 0; ci < colLabels.length; ci++) {
          const v = values[ri]?.[ci] ?? 0;
          const t = (v - minValue) / range;
          const barHeight = Math.max(0.08, t * 3 + 0.1);
          placeBar(ri, ci, barHeight, t);
        }
      }
    }

    const onClick = (e: MouseEvent) => handleClick(e, renderer!, camera, pickables);
    const onMove = (e: MouseEvent) => {
      const rect = renderer!.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(pickables, true);
      if (hits.length > 0) {
        const d = hits[0].object.userData;
        if (d.row !== undefined) {
          setHover(`${rowDim}: ${d.row} · ${colDim}: ${d.col} · ${measureName}: ${d.value}`);
          return;
        }
      }
      setHover(null);
    };

    renderer.domElement.addEventListener("click", onClick);
    renderer.domElement.addEventListener("mousemove", onMove);

    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer?.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current || !renderer) return;
      const next = getSize();
      width = next.width;
      height = next.height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      renderer?.domElement.removeEventListener("click", onClick);
      renderer?.domElement.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(frameId);
      controls.dispose();
      barGeo.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        }
      });
      renderer?.dispose();
      containerRef.current?.replaceChildren();
    };
  }, [pivot, use2d, handleClick]);

  if (!pivot) {
    return (
      <div className="fallback-card">
        <p className="status-title">Cube view unavailable</p>
        <p className="muted">
          Run a query with two dimensions and one numeric measure (e.g. status × region × total amount).
        </p>
        {onRunDemoQuery ? (
          <button
            type="button"
            className="button"
            style={{ marginTop: 12 }}
            onClick={() => onRunDemoQuery(CUBE_BY_STATUS_REGION)}
          >
            Run cube demo query
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="cube-viewer-wrap">
      <div className="cube-toolbar">
        <span className="muted">
          {pivot.rowDim} × {pivot.colDim} → {pivot.measureName}
          {pivot.truncated
            ? ` · showing top ${pivot.rowLabels.length}×${pivot.colLabels.length} of ${pivot.totalCells ?? "?"} cells`
            : null}
        </span>
        <button type="button" className="button ghost" onClick={() => setUse2d((v) => !v)}>
          {use2d ? "Show 3D" : "Switch to 2D heatmap"}
        </button>
      </div>
      {hover ? <p className="cube-hover">{hover}</p> : null}
      <p className="muted cube-hint">Drag to rotate · scroll to zoom · click a bar to drill</p>
      {use2d ? (
        <FallbackHeatmap pivot={pivot} />
      ) : (
        <div className="canvas-shell canvas-shell-tall" ref={containerRef} />
      )}
    </div>
  );
};

export default CubeViewer;
