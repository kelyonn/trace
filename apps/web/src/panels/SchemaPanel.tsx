import type { Column } from "@trace/shared-types";

type Props = {
  schemaTables: string[];
  selectedTable: string | null;
  tableColumns: Column[];
  loading: boolean;
  onSelectTable: (table: string) => void;
  onPreview: () => void;
};

const SchemaPanel = ({
  schemaTables,
  selectedTable,
  tableColumns,
  loading,
  onSelectTable,
  onPreview
}: Props) => (
  <section className="panel">
    <div className="panel-header">
      <h2>Schema browser</h2>
      <span className="muted panel-step">2 · Explore</span>
    </div>
    <div className="schema-grid">
      <div className="schema-list">
        {schemaTables.length ? (
          schemaTables.map((table) => (
            <button
              key={table}
              type="button"
              className={table === selectedTable ? "schema-item active" : "schema-item"}
              onClick={() => onSelectTable(table)}
            >
              {table}
            </button>
          ))
        ) : (
          <p className="muted">No tables found.</p>
        )}
      </div>
      <div className="schema-detail">
        {selectedTable ? (
          <>
            <div className="schema-header">
              <p className="status-title">{selectedTable}</p>
              <button type="button" className="button ghost" onClick={onPreview} disabled={loading}>
                Preview
              </button>
            </div>
            {tableColumns.length ? (
              <ul>
                {tableColumns.map((column) => (
                  <li key={`${selectedTable}-${column.name}`}>
                    <span>{column.name}</span>
                    <span className="muted">{column.type}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Loading columns...</p>
            )}
          </>
        ) : (
          <p className="muted">Select a table to inspect columns.</p>
        )}
      </div>
    </div>
  </section>
);

export default SchemaPanel;
