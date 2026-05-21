# Trace Pilot Package

## Onboarding checklist

1. Confirm Docker Desktop is running.
2. Clone the repo and run `./run.sh` from the root.
3. Verify `http://localhost:3000/api/v1/status` returns Trino and Postgres online.
4. Open `http://localhost:5173`.
5. Run the demo query from the **Query runner** presets.
6. Run `bash infra/scripts/sanity_check.sh` — expect `Sanity checks passed.`

## Demo script

1. **Status panel** — show Trino and Postgres online; confirm active data source.
2. **Schema browser** — click `customers` and `orders` to inspect columns.
3. **Semantic builder** — select the `orders` cube, choose `total_amount` measure, check `status` and `region` dimensions; click Generate SQL.
4. **Query runner** — run the generated SQL; results appear in the table.
5. **Cube view** — click Cube View in the Results panel; 3-D bars render. Drag to rotate. Click a bar to drill.
6. **Stream mode** — click Stream; rows arrive incrementally in the Stream results panel.
7. **Insight assistant** — click Summarize to see min/max/avg stats.
8. **Export** — set role to `admin`; click Export CSV; file downloads.
9. **Snapshots** — click Save snapshot; reopen it from the Snapshots list.
10. **Notebook** — write notes; save and reopen.
11. **Alerts** — create an alert rule; click Evaluate.
12. **Auth** (optional) — click Sign in with Keycloak; sign in as `admin@trace.local`.

## Success metrics

- Time to first query: ≤ 5 minutes.
- P95 query latency: ≤ 2 seconds on the sample dataset.
- 3-D cube renders and rotates smoothly at ≥ 60 FPS (2-D fallback activates at < 20 FPS).
- Export success rate: ≥ 95%.
- UI rated "useful or better" by ≥ 80% of pilot participants.
