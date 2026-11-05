import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { AXES, type AxisKey, type CubeGrid } from "./olap";

export type Cell = { x: number; y: number; z: number };
export type CameraPreset = "iso" | "front" | "top" | "side";
export type Slice = { axis: AxisKey; index: number } | null;

type Props = {
  grid: CubeGrid;
  visible: Record<AxisKey, boolean[]>;
  slice: Slice;
  hover: Partial<Cell> | null;
  selected: Cell | null;
  axisTitles: Record<AxisKey, string>;
  theme: string;
  preset: { name: CameraPreset; nonce: number };
  autoRotate: boolean;
  valueFormat: (n: number) => string;
  onHover: (cell: Cell | null, client?: { x: number; y: number }) => void;
  onSelect: (cell: Cell | null) => void;
  onDrill: (cell: Cell) => void;
  onLabel: (axis: AxisKey, index: number, mode: "slice" | "dice") => void;
};

const GAP = 1.0;

function readVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function usePalette(theme: string) {
  return useMemo(() => {
    const ramp = [1, 2, 3, 4, 5, 6].map((i) => new THREE.Color(readVar(`--seq-${i}`, "#3987e5")));
    return {
      ramp: (t: number) => {
        const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
        const i = Math.min(ramp.length - 2, Math.floor(x));
        return ramp[i].clone().lerp(ramp[i + 1], x - i);
      },
      ghost: new THREE.Color(readVar("--cube-ghost", "#3a3c44")),
      select: new THREE.Color(readVar("--select", "#f5a524")),
      ink: new THREE.Color(readVar("--text-secondary", "#a3a29c")),
      line: new THREE.Color(readVar("--cube-line", "#3a3c44")),
      bg: new THREE.Color(readVar("--scene-bg", "#0d0e10")),
      light: theme === "light"
    };
  }, [theme]);
}

/** Visible-member compaction: position index per member, or -1 when diced out. */
function layout(visible: boolean[]) {
  const pos: number[] = [];
  let n = 0;
  for (const v of visible) pos.push(v ? n++ : -1);
  return { pos, n: Math.max(1, n) };
}

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();

function Voxels({
  grid,
  visible,
  slice,
  palette,
  onHover,
  onSelect,
  onDrill
}: Pick<Props, "grid" | "visible" | "slice" | "onHover" | "onSelect" | "onDrill"> & {
  palette: ReturnType<typeof usePalette>;
}) {
  const nx = grid.members.x.length;
  const ny = grid.members.y.length;
  const nz = grid.members.z.length;
  const count = nx * ny * nz;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new RoundedBoxGeometry(0.9, 0.9, 0.9, 2, 0.07), []);

  // Animated state per instance (current → target).
  const state = useMemo(
    () => ({
      pos: new Float32Array(count * 3),
      scale: new Float32Array(count),
      color: new Float32Array(count * 3),
      tPos: new Float32Array(count * 3),
      tScale: new Float32Array(count),
      tColor: new Float32Array(count * 3),
      active: new Uint8Array(count),
      settled: false
    }),
    [count]
  );

  useEffect(() => {
    const lx = layout(visible.x);
    const ly = layout(visible.y);
    const lz = layout(visible.z);
    const range = grid.max - Math.min(0, grid.min) || 1;
    for (let xi = 0; xi < nx; xi++)
      for (let yi = 0; yi < ny; yi++)
        for (let zi = 0; zi < nz; zi++) {
          const id = (xi * ny + yi) * nz + zi;
          const v = grid.values[xi][yi][zi];
          const shown = lx.pos[xi] >= 0 && ly.pos[yi] >= 0 && lz.pos[zi] >= 0 && v !== null;
          const inSlice = !slice || [xi, yi, zi][AXES.indexOf(slice.axis)] === slice.index;
          // Diced-out members collapse toward their neighbours so the layout closes up smoothly.
          state.tPos[id * 3] = ((lx.pos[xi] >= 0 ? lx.pos[xi] : 0) - (lx.n - 1) / 2) * GAP;
          state.tPos[id * 3 + 1] = ((ly.pos[yi] >= 0 ? ly.pos[yi] : 0) - (ly.n - 1) / 2) * GAP;
          state.tPos[id * 3 + 2] = ((lz.pos[zi] >= 0 ? lz.pos[zi] : 0) - (lz.n - 1) / 2) * GAP;
          let s = 0;
          let c = palette.ghost;
          if (shown) {
            const t = Math.sqrt(Math.max(0, ((v as number) - Math.min(0, grid.min)) / range));
            if (inSlice) {
              s = 0.28 + 0.72 * t;
              c = palette.ramp(0.1 + 0.9 * t);
            } else {
              s = 0.16;
              c = palette.ghost;
            }
          }
          state.tScale[id] = s;
          state.tColor[id * 3] = c.r;
          state.tColor[id * 3 + 1] = c.g;
          state.tColor[id * 3 + 2] = c.b;
          state.active[id] = shown && inSlice ? 1 : 0;
        }
    state.settled = false;
  }, [grid, visible, slice, palette, nx, ny, nz, state]);

  useFrame((_, dt) => {
    const mesh = meshRef.current;
    if (!mesh || state.settled) return;
    const k = 1 - Math.pow(0.0008, dt); // frame-rate independent easing
    let moving = false;
    for (let id = 0; id < count; id++) {
      for (let j = 0; j < 3; j++) {
        const p = id * 3 + j;
        const dp = state.tPos[p] - state.pos[p];
        const dc = state.tColor[p] - state.color[p];
        if (Math.abs(dp) > 1e-3 || Math.abs(dc) > 1e-3) moving = true;
        state.pos[p] += dp * k;
        state.color[p] += dc * k;
      }
      const ds = state.tScale[id] - state.scale[id];
      if (Math.abs(ds) > 1e-3) moving = true;
      state.scale[id] += ds * k;
      const s = Math.max(1e-4, state.scale[id]);
      tmpObj.position.set(state.pos[id * 3], state.pos[id * 3 + 1], state.pos[id * 3 + 2]);
      tmpObj.scale.setScalar(s);
      tmpObj.updateMatrix();
      mesh.setMatrixAt(id, tmpObj.matrix);
      tmpColor.setRGB(state.color[id * 3], state.color[id * 3 + 1], state.color[id * 3 + 2]);
      mesh.setColorAt(id, tmpColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (!moving) state.settled = true;
  });

  const decode = (id: number): Cell => ({ x: Math.floor(id / (ny * nz)), y: Math.floor(id / nz) % ny, z: id % nz });

  const firstActive = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    for (const hit of e.intersections) {
      if (hit.object === meshRef.current && hit.instanceId !== undefined && state.active[hit.instanceId]) {
        return decode(hit.instanceId);
      }
    }
    return null;
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, count]}
      onPointerMove={(e) => {
        e.stopPropagation();
        const cell = firstActive(e);
        onHover(cell, cell ? { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } : undefined);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        if (e.delta > 4) return;
        e.stopPropagation();
        onSelect(firstActive(e));
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        const cell = firstActive(e);
        if (cell) onDrill(cell);
      }}
    >
      <meshStandardMaterial roughness={0.42} metalness={0.05} />
    </instancedMesh>
  );
}

function Frame({
  grid,
  visible,
  slice,
  hover,
  selected,
  axisTitles,
  palette,
  valueFormat,
  onLabel
}: Pick<Props, "grid" | "visible" | "slice" | "hover" | "selected" | "axisTitles" | "valueFormat" | "onLabel"> & {
  palette: ReturnType<typeof usePalette>;
}) {
  const lx = layout(visible.x);
  const ly = layout(visible.y);
  const lz = layout(visible.z);
  const hx = (lx.n / 2) * GAP;
  const hy = (ly.n / 2) * GAP;
  const hz = (lz.n / 2) * GAP;
  const coord = (l: ReturnType<typeof layout>, i: number) => (l.pos[i] - (l.n - 1) / 2) * GAP;

  // Back walls: floor (y=-hy), back (z=-hz), left (x=-hx) with grid lines at member boundaries.
  const walls = useMemo(() => {
    const pts: number[] = [];
    const push = (a: number[], b: number[]) => pts.push(...a, ...b);
    for (let i = 0; i <= lx.n; i++) {
      const x = (i - lx.n / 2) * GAP;
      push([x, -hy, -hz], [x, -hy, hz]);
      push([x, -hy, -hz], [x, hy, -hz]);
    }
    for (let i = 0; i <= ly.n; i++) {
      const y = (i - ly.n / 2) * GAP;
      push([-hx, y, -hz], [hx, y, -hz]);
      push([-hx, y, -hz], [-hx, y, hz]);
    }
    for (let i = 0; i <= lz.n; i++) {
      const z = (i - lz.n / 2) * GAP;
      push([-hx, -hy, z], [hx, -hy, z]);
      push([-hx, -hy, z], [-hx, hy, z]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [lx.n, ly.n, lz.n, hx, hy, hz]);

  const box = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz)), [hx, hy, hz]);
  const cellEdges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), []);

  const crosshair = useMemo(() => {
    if (!hover) return null;
    const pts: number[] = [];
    const has = (k: AxisKey) => hover[k] !== undefined && hover[k] !== null;
    const px = has("x") ? coord(lx, hover.x!) : null;
    const py = has("y") ? coord(ly, hover.y!) : null;
    const pz = has("z") ? coord(lz, hover.z!) : null;
    if (px !== null && py !== null) pts.push(px, py, -hz, px, py, hz);
    if (px !== null && pz !== null) pts.push(px, -hy, pz, px, hy, pz);
    if (py !== null && pz !== null) pts.push(-hx, py, pz, hx, py, pz);
    // Drop lines to the walls so the coordinate reads on each projection.
    if (px !== null && py !== null && pz !== null) {
      pts.push(px, py, pz, px, -hy, pz);
    }
    if (!pts.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, lx.n, ly.n, lz.n, visible]);

  // Hide an axis's member labels while the camera looks straight along it (they would stack on one point).
  const { camera } = useThree();
  const [edgeOn, setEdgeOn] = useState<Record<AxisKey, boolean>>({ x: false, y: false, z: false });
  const dirRef = useRef(new THREE.Vector3());
  useFrame(() => {
    camera.getWorldDirection(dirRef.current);
    const d = dirRef.current;
    const next = { x: Math.abs(d.x) > 0.93, y: Math.abs(d.y) > 0.93, z: Math.abs(d.z) > 0.93 };
    if (next.x !== edgeOn.x || next.y !== edgeOn.y || next.z !== edgeOn.z) setEdgeOn(next);
  });

  const maxTotal = (k: AxisKey) => Math.max(1, ...grid.members[k].map((m) => Math.abs(m.total)));
  const isHot = (k: AxisKey, i: number) =>
    (hover && hover[k] === i) || (selected && selected[k] === i) || (slice && slice.axis === k && slice.index === i);

  const label = (k: AxisKey, i: number, position: [number, number, number], align: "left" | "right" | "center") => {
    const m = grid.members[k][i];
    const share = Math.abs(m.total) / maxTotal(k);
    return (
      <Html key={`${k}-${m.key}`} position={position} center={align === "center"} zIndexRange={[20, 0]}>
        <button
          type="button"
          className={`axis-label axis-${k} align-${align}${isHot(k, i) ? " hot" : ""}${slice && slice.axis === k && slice.index === i ? " sliced" : ""}`}
          title={`${m.label} · ${valueFormat(m.total)}\nClick: slice · Shift-click: hide (dice)`}
          onClick={(e) => onLabel(k, i, e.shiftKey || e.altKey ? "dice" : "slice")}
        >
          <span className="axis-label-text">{m.label}</span>
          <span className="axis-label-bar" style={{ width: `${Math.max(2, share * 36)}px` }} />
        </button>
      </Html>
    );
  };

  const selCoords = selected && lx.pos[selected.x] >= 0 && ly.pos[selected.y] >= 0 && lz.pos[selected.z] >= 0
    ? ([coord(lx, selected.x), coord(ly, selected.y), coord(lz, selected.z)] as [number, number, number])
    : null;

  return (
    <group>
      <lineSegments geometry={walls}>
        <lineBasicMaterial color={palette.line} transparent opacity={palette.light ? 0.55 : 0.5} />
      </lineSegments>
      <lineSegments geometry={box}>
        <lineBasicMaterial color={palette.line} transparent opacity={0.9} />
      </lineSegments>
      {crosshair ? (
        <lineSegments geometry={crosshair}>
          <lineBasicMaterial color={palette.select} transparent opacity={0.75} />
        </lineSegments>
      ) : null}
      {selCoords ? (
        <lineSegments geometry={cellEdges} position={selCoords}>
          <lineBasicMaterial color={palette.select} linewidth={2} />
        </lineSegments>
      ) : null}

      {edgeOn.x ? null : grid.members.x.map((_, i) => (lx.pos[i] >= 0 ? label("x", i, [coord(lx, i), -hy - 0.25, hz + 0.25], "right") : null))}
      {edgeOn.y ? null : grid.members.y.map((_, i) => (ly.pos[i] >= 0 ? label("y", i, [-hx - 0.25, coord(ly, i), hz + 0.25], "right") : null))}
      {edgeOn.z ? null : grid.members.z.map((_, i) => (lz.pos[i] >= 0 ? label("z", i, [hx + 0.25, -hy - 0.25, coord(lz, i)], "left") : null))}

      <Html position={[0, -hy - 0.4, hz + 2.6]} center zIndexRange={[20, 0]}>
        <span className="axis-title">X · {axisTitles.x}</span>
      </Html>
      <Html position={[-hx - 2.6, hy + 0.7, hz]} center zIndexRange={[20, 0]}>
        <span className="axis-title">Y · {axisTitles.y}</span>
      </Html>
      <Html position={[hx + 2.6, -hy - 0.4, 0]} center zIndexRange={[20, 0]}>
        <span className="axis-title">Z · {axisTitles.z}</span>
      </Html>
    </group>
  );
}

function CameraRig({ preset, radius, autoRotate }: { preset: Props["preset"]; radius: number; autoRotate: boolean }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitControlsImpl | null };
  const target = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    const fov = (camera.fov * Math.PI) / 180;
    const fitH = radius / Math.sin(fov / 2);
    const fitW = radius / Math.sin(Math.atan(Math.tan(fov / 2) * camera.aspect));
    const d = Math.max(fitH, fitW) * 0.74;
    const dirs: Record<CameraPreset, [number, number, number]> = {
      iso: [0.55, 0.42, 1],
      front: [0, 0, 1],
      top: [0, 1, 0.0001],
      side: [1, 0, 0]
    };
    target.current = new THREE.Vector3(...dirs[preset.name]).normalize().multiplyScalar(d);
  }, [preset, radius, camera]);

  useEffect(() => {
    if (!controls) return;
    const cancel = () => {
      target.current = null;
    };
    controls.addEventListener("start", cancel);
    return () => controls.removeEventListener("start", cancel);
  }, [controls]);

  useFrame((_, dt) => {
    if (controls) {
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 0.7;
    }
    if (!target.current) return;
    const k = 1 - Math.pow(0.002, dt);
    camera.position.lerp(target.current, k);
    controls?.target.lerp(new THREE.Vector3(0, 0, 0), k);
    camera.lookAt(0, 0, 0);
    if (camera.position.distanceTo(target.current) < 0.02) target.current = null;
  });
  return null;
}

const CubeScene = (props: Props) => {
  const palette = usePalette(props.theme);
  const [ex, ey, ez] = AXES.map((k) => ((props.visible[k].filter(Boolean).length || 1) * GAP) / 2);
  // Bounding sphere of the cube plus room for the axis labels around it.
  const radius = Math.sqrt(ex * ex + ey * ey + ez * ez) + 2.2;
  const extent = radius;

  return (
    <Canvas
      camera={{ position: [extent * 1.8, extent * 1.3, extent * 2.3], fov: 34, near: 0.1, far: 500 }}
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onPointerMissed={(e) => {
        // Clicks on HTML axis labels bubble through the canvas container; only clear on empty-canvas clicks.
        if (e.type === "click" && (e.target as HTMLElement | null)?.tagName === "CANVAS") props.onSelect(null);
      }}
    >
      <color attach="background" args={[palette.bg]} />
      <hemisphereLight args={[palette.light ? 0xffffff : 0xcfd8ff, palette.light ? 0xd9d5cc : 0x15161a, palette.light ? 1.2 : 1.0]} />
      <directionalLight position={[8, 14, 10]} intensity={palette.light ? 1.5 : 1.7} />
      <directionalLight position={[-10, 4, -6]} intensity={0.35} />
      <Voxels
        grid={props.grid}
        visible={props.visible}
        slice={props.slice}
        palette={palette}
        onHover={props.onHover}
        onSelect={props.onSelect}
        onDrill={props.onDrill}
      />
      <Frame
        grid={props.grid}
        visible={props.visible}
        slice={props.slice}
        hover={props.hover}
        selected={props.selected}
        axisTitles={props.axisTitles}
        palette={palette}
        valueFormat={props.valueFormat}
        onLabel={props.onLabel}
      />
      <OrbitControls makeDefault enableDamping dampingFactor={0.09} minDistance={3} maxDistance={80} />
      <CameraRig preset={props.preset} radius={radius} autoRotate={props.autoRotate} />
    </Canvas>
  );
};

export default CubeScene;
