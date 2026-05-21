# @trace/ui-kit

Reusable React UI components shared across Trace web apps.

## Planned components

| Component | Purpose |
|-----------|---------|
| `Button` | Accent and ghost button variants |
| `Pill` | Status pill (ok / warn) |
| `Panel` | Card container with header slot |
| `DataTable` | Paginated, sortable result table |
| `SqlEditor` | Textarea with monospace font and syntax highlight hints |
| `StatusBadge` | Online/Offline indicator |

## Development

This package is a workspace-internal package (`"@trace/ui-kit": "*"` in dependents). Build:

```bash
npm -w packages/ui-kit run build
```

Components use the CSS variables defined in `apps/web/src/styles.css` (--accent, --ink, --muted, --card) so they match the app theme without bundling their own stylesheet.
