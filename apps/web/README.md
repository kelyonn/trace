# @trace/web

React web application — query runner, schema browser, 3-D cube viewer, notebook, alerts, and snapshots.

## Structure

```
src/
  App.tsx           Main shell with all panels
  main.tsx          React root mount
  styles.css        Design tokens and global styles
  cube/
    CubeViewer.tsx  3-D OLAP bar chart with OrbitControls and drill-through
    pivot.ts        Pure function: QueryResponse → pivot shape
  hooks/
    useAuth.ts      Keycloak PKCE flow (Phase 5)
    useQueryStream.ts  SSE streaming consumer (Phase 6)
```

## Dev

```bash
npm run dev         # Vite dev server on :5173
npm run build       # Production build to dist/
```

## API connection

The app expects the API at `http://localhost:3000`. In production override the `apiBase` constant or proxy via Vite's `server.proxy`.
