import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { PivotShape } from "./pivot";
import Heatmap from "../components/charts/Heatmap";
import Icon from "../components/Icon";

type Props = {
  pivot: PivotShape;
  onDrill?: (rowLabel: string, colLabel: string) => void;
  valueFormat?: (n: number) => string;
  /** Changes when the app theme flips so the scene re-reads its colors. */
  theme?: string;
  tall?: boolean;
};

const SPACING = 1.25;
const BAR = 0.86;
const MAX_H = 5;
const FPS_FLOOR = 20;

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Interpolates the theme's sequential ramp (seq-1 … seq-6) at t ∈ [0,1]. */
function rampSampler(): (t: number) => THREE.Color {
  const stops = [1, 2, 3, 4, 5, 6].map((i) => new THREE.Color(cssVar(`--seq-${i}`, "#3987e5")));
  return (t: number) => {
    const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    return stops[i].clone().lerp(stops[i + 1], x - i);
  };
}

function makeLabel(text: string, color: string, opts: { size?: number; weight?: number } = {}): THREE.Sprite {
  const size = opts.size ?? 30;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `${opts.weight ?? 500} ${size}px Inter, system-ui, sans-serif`;
  ctx.font = font;
  const label = text.length > 22 ? `${text.slice(0, 21)}…` : text;
  const w = Math.ceil(ctx.measureText(label).width) + 16;
  const h = size + 14;
  canvas.width = w * 2;
  canvas.height = h * 2;
  ctx.scale(2, 2);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(label, 8, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  const scale = 0.0155 * (size / 30);
  sprite.scale.set(w * scale * 1.0, h * scale, 1);
  sprite.renderOrder = 2;
  return sprite;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

const CubeViewer = ({ pivot, onDrill, valueFormat = (n) => n.toLocaleString(), theme, tall }: Props) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [use2d, setUse2d] = useState(false);
  const [autoFallback, setAutoFallback] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; row: string; col: string; value: number } | null>(null);
  const autoRotateRef = useRef(autoRotate);
  const resetRef = useRef<() => void>(() => {});
  const onDrillRef = useRef(onDrill);
  onDrillRef.current = onDrill;
  autoRotateRef.current = autoRotate;

  useEffect(() => {
    setAutoFallback(false);
  }, [pivot]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || use2d) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    } catch {
      setUse2d(true);
      setAutoFallback(true);
      return;
    }

    const { rowLabels, colLabels, values, minValue, maxValue, rowDim, colDim } = pivot;
    const nR = rowLabels.length;
    const nC = colLabels.length;
    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 440;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.replaceChildren(renderer.domElement);

    const bg = new THREE.Color(cssVar("--scene-bg", "#121318"));
    const floorColor = new THREE.Color(cssVar("--scene-floor", "#1b1d23"));
    const ink = cssVar("--text-secondary", "#b9b8b0");
    const inkStrong = cssVar("--text-primary", "#f0efec");
    const isLight = document.documentElement.dataset.theme === "light";
    const sample = rampSampler();

    const scene = new THREE.Scene();
    scene.background = bg;
    scene.fog = new THREE.Fog(bg, 40, 90);

    const spanX = nR * SPACING;
    const spanZ = nC * SPACING;
    const cx = (spanX - SPACING) / 2;
    const cz = (spanZ - SPACING) / 2;
    const radius = Math.max(spanX, spanZ, 6);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 400);
    const dist = radius * 1.35 + 5;
    const home = new THREE.Vector3(cx, MAX_H * 0.3, cz).add(new THREE.Vector3(0.62, 0.55, 0.75).normalize().multiplyScalar(dist));
    camera.position.copy(home);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(cx, MAX_H * 0.3, cz);
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 4;
    controls.maxDistance = radius * 4;
    controls.autoRotateSpeed = 0.8;
    resetRef.current = () => {
      camera.position.copy(home);
      controls.target.set(cx, MAX_H * 0.3, cz);
    };

    scene.add(new THREE.HemisphereLight(isLight ? 0xffffff : 0xbcc8ff, isLight ? 0xd8d4cc : 0x1a1a22, isLight ? 1.1 : 0.9));
    const key = new THREE.DirectionalLight(0xffffff, isLight ? 1.6 : 1.9);
    key.position.set(cx + radius, radius * 1.6, cz - radius * 0.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -radius;
    sc.right = radius;
    sc.top = radius;
    sc.bottom = -radius;
    sc.far = radius * 5;
    key.target.position.set(cx, 0, cz);
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x9085e9, isLight ? 0.25 : 0.6);
    rim.position.set(cx - radius, radius * 0.6, cz + radius);
    scene.add(rim);

    // Floor plate + cell grid
    const plateGeo = new THREE.BoxGeometry(spanX + 1.2, 0.12, spanZ + 1.2);
    const plate = new THREE.Mesh(
      plateGeo,
      new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.95, metalness: 0 })
    );
    plate.position.set(cx, -0.06, cz);
    plate.receiveShadow = true;
    scene.add(plate);

    const gridMat = new THREE.LineBasicMaterial({ color: new THREE.Color(ink), transparent: true, opacity: 0.12 });
    const gridPts: THREE.Vector3[] = [];
    for (let i = 0; i <= nR; i++) {
      const x = i * SPACING - SPACING / 2;
      gridPts.push(new THREE.Vector3(x, 0.005, -SPACING / 2), new THREE.Vector3(x, 0.005, spanZ - SPACING / 2));
    }
    for (let j = 0; j <= nC; j++) {
      const z = j * SPACING - SPACING / 2;
      gridPts.push(new THREE.Vector3(-SPACING / 2, 0.005, z), new THREE.Vector3(spanX - SPACING / 2, 0.005, z));
    }
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPts), gridMat));

    // Bars
    const range = maxValue - Math.min(0, minValue) || 1;
    const base = Math.min(0, minValue);
    const geo = new RoundedBoxGeometry(BAR, 1, BAR, 2, 0.06);
    geo.translate(0, 0.5, 0);
    const bars: THREE.Mesh[] = [];
    for (let ri = 0; ri < nR; ri++) {
      for (let ci = 0; ci < nC; ci++) {
        const v = values[ri]?.[ci] ?? 0;
        const t = (v - base) / range;
        const h = Math.max(0.04, t * MAX_H);
        // sqrt scale for color: revenue is heavy-tailed, so linear color would flatten most cells.
        const color = sample(Math.sqrt(Math.max(0, t)));
        const mat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.38,
          metalness: 0.12,
          emissive: color.clone(),
          emissiveIntensity: isLight ? 0.02 : 0.12
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(ri * SPACING, 0, ci * SPACING);
        mesh.scale.y = 0.001;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { row: rowLabels[ri], col: colLabels[ci], value: v, target: h, delay: (ri + ci) * 18 };
        scene.add(mesh);
        bars.push(mesh);
      }
    }

    // Axis labels on the two edges facing the default camera (front z-edge for rows, right x-edge for cols).
    const labelSize = Math.max(18, Math.min(24, 380 / Math.max(nR, nC)));
    const frontZ = spanZ - SPACING / 2 + 0.35;
    const rightX = spanX - SPACING / 2 + 0.35;
    rowLabels.forEach((label, ri) => {
      const s = makeLabel(label, ink, { size: labelSize });
      s.center.set(1, 0.5);
      s.position.set(ri * SPACING + 0.2, 0.05, frontZ + 0.2);
      scene.add(s);
    });
    colLabels.forEach((label, ci) => {
      const s = makeLabel(label, ink, { size: labelSize });
      s.center.set(0, 0.5);
      s.position.set(rightX, 0.05, ci * SPACING);
      scene.add(s);
    });
    const rowTitle = makeLabel(`${rowDim.toUpperCase()} →`, inkStrong, { size: 26, weight: 700 });
    rowTitle.center.set(0.5, 0);
    rowTitle.position.set(cx, -1.1, frontZ + 1.8);
    const colTitle = makeLabel(`← ${colDim.toUpperCase()}`, inkStrong, { size: 26, weight: 700 });
    colTitle.center.set(0.5, 0);
    colTitle.position.set(rightX + 1.8, -1.1, cz);
    scene.add(rowTitle, colTitle);

    // Interaction
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered: THREE.Mesh | null = null;
    let downAt: { x: number; y: number } | null = null;

    const pick = (e: PointerEvent): THREE.Mesh | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(bars, false)[0];
      return (hit?.object as THREE.Mesh) ?? null;
    };

    const setHovered = (mesh: THREE.Mesh | null) => {
      if (hovered === mesh) return;
      if (hovered) {
        const m = hovered.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = isLight ? 0.02 : 0.12;
      }
      hovered = mesh;
      if (hovered) {
        const m = hovered.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = isLight ? 0.35 : 0.55;
      }
      renderer.domElement.style.cursor = mesh ? "pointer" : "grab";
    };

    const onMove = (e: PointerEvent) => {
      const mesh = pick(e);
      setHovered(mesh);
      if (mesh) {
        const rect = renderer.domElement.getBoundingClientRect();
        const d = mesh.userData;
        setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, row: d.row, col: d.col, value: d.value });
      } else {
        setTip(null);
      }
    };
    const onLeave = () => {
      setHovered(null);
      setTip(null);
    };
    const onDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > 5) return;
      const mesh = pick(e);
      if (mesh && onDrillRef.current) onDrillRef.current(mesh.userData.row, mesh.userData.col);
    };

    const el = renderer.domElement;
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);

    // Render loop with grow-in animation + FPS budget (FR-10 fallback).
    const start = performance.now();
    let frames = 0;
    let lastSample = start;
    let lowSamples = 0;
    let frameId = 0;
    const animate = (now: number) => {
      frameId = requestAnimationFrame(animate);
      const elapsed = now - start;
      for (const b of bars) {
        const { target, delay } = b.userData;
        const p = Math.max(0, Math.min(1, (elapsed - delay) / 750));
        b.scale.y = Math.max(0.001, target * easeOut(p));
      }
      controls.autoRotate = autoRotateRef.current;
      controls.update();
      renderer.render(scene, camera);

      frames++;
      if (now - lastSample >= 1000) {
        const current = (frames * 1000) / (now - lastSample);
        setFps(Math.round(current));
        frames = 0;
        lastSample = now;
        if (now - start > 2500 && current < FPS_FLOOR && !document.hidden) {
          lowSamples++;
          if (lowSamples >= 3) {
            setAutoFallback(true);
            setUse2d(true);
          }
        } else {
          lowSamples = 0;
        }
      }
    };
    frameId = requestAnimationFrame(animate);

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(frameId);
      ro.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      controls.dispose();
      scene.traverse((obj) => {
        const o = obj as THREE.Mesh;
        if (o.geometry) o.geometry.dispose();
        const mat = o.material as THREE.Material | THREE.Material[] | undefined;
        const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
        for (const m of mats) {
          const map = (m as THREE.SpriteMaterial).map;
          if (map) map.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      mount.replaceChildren();
      setTip(null);
    };
  }, [pivot, use2d, theme]);

  const cells = pivot.rowLabels.length * pivot.colLabels.length;

  return (
    <div className="cube-viewer-wrap">
      <div className="cube-toolbar">
        <div className="drill-trail">
          <span className="pill accent">{pivot.rowDim}</span>
          <Icon name="x" />
          <span className="pill accent">{pivot.colDim}</span>
          <Icon name="chevron" />
          <span className="pill">{pivot.measureName}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {pivot.truncated
              ? `top ${pivot.rowLabels.length}×${pivot.colLabels.length} of ${pivot.totalCells ?? "?"} cells`
              : `${cells} cells`}
          </span>
        </div>
        <div className="segmented" role="tablist" aria-label="Cube rendering mode">
          <button type="button" className={!use2d ? "active" : ""} onClick={() => setUse2d(false)}>
            <Icon name="cube" /> 3D
          </button>
          <button type="button" className={use2d ? "active" : ""} onClick={() => setUse2d(true)}>
            <Icon name="table" /> 2D heatmap
          </button>
        </div>
      </div>

      {autoFallback && use2d ? (
        <div className="banner warn">
          <Icon name="alert" />
          <div>
            <p className="status-title">Switched to the 2-D view</p>
            <p className="muted">3-D rendering dropped below {FPS_FLOOR} FPS (or WebGL is unavailable) on this device.</p>
          </div>
        </div>
      ) : null}

      {use2d ? (
        <div className="card" style={{ boxShadow: "none" }}>
          <Heatmap
            rowLabels={pivot.rowLabels}
            colLabels={pivot.colLabels}
            values={pivot.values}
            rowTitle={pivot.rowDim}
            colTitle={pivot.colDim}
            valueFormat={valueFormat}
            onCellClick={onDrill}
          />
        </div>
      ) : (
        <div className="cube-stage">
          <div className={tall ? "canvas-shell tall" : "canvas-shell"} ref={mountRef} />
          <div className="cube-controls">
            <button
              type="button"
              className={autoRotate ? "button icon" : "button ghost icon"}
              title="Auto-rotate"
              aria-pressed={autoRotate}
              onClick={() => setAutoRotate((v) => !v)}
            >
              <Icon name="rotate" />
            </button>
            <button type="button" className="button ghost icon" title="Reset camera" onClick={() => resetRef.current()}>
              <Icon name="target" />
            </button>
          </div>
          <div className="cube-legend">
            <span>{pivot.measureName}</span>
            <div className="gradient-legend">
              <span>{valueFormat(Math.min(0, pivot.minValue))}</span>
              <span className="bar" />
              <span>{valueFormat(pivot.maxValue)}</span>
            </div>
            {fps !== null ? <span className="fps muted">{fps} fps</span> : null}
          </div>
          {tip ? (
            <div className="cube-tooltip" style={{ left: tip.x, top: tip.y }}>
              <div className="tt-title" style={{ fontWeight: 600 }}>
                {tip.row} · {tip.col}
              </div>
              <div className="secondary">
                {pivot.measureName}: <b style={{ color: "var(--text-primary)" }}>{valueFormat(tip.value)}</b>
              </div>
              {onDrill ? <div className="muted" style={{ fontSize: 11 }}>Click to drill in</div> : null}
            </div>
          ) : null}
        </div>
      )}
      <div className="cube-hint">
        <span>
          <Icon name="rotate" size={13} /> Drag to orbit
        </span>
        <span>Scroll to zoom · right-drag to pan</span>
        {onDrill ? <span>Click a bar to drill through</span> : null}
      </div>
    </div>
  );
};

export default CubeViewer;
