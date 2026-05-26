import type { SemanticCube, SemanticModel } from "@trace/shared-types";
import type { Column } from "@trace/shared-types";

type Props = {
  semanticModel: SemanticModel | null;
  selectedCube: SemanticCube | null;
  selectedMeasure: string;
  selectedDimensions: string[];
  schemaTables: string[];
  tableColumns: Column[];
  builderTable: string | null;
  builderColumns: string[];
  builderLimit: number;
  onCubeChange: (cube: SemanticCube | null) => void;
  onMeasureChange: (measure: string) => void;
  onDimensionToggle: (dim: string) => void;
  onBuildSemanticSql: () => void;
  onBuilderTableChange: (table: string) => void;
  onToggleColumn: (column: string) => void;
  onBuilderLimitChange: (limit: number) => void;
  onBuildSql: () => void;
};

const BuildersPanel = ({
  semanticModel,
  selectedCube,
  selectedMeasure,
  selectedDimensions,
  schemaTables,
  tableColumns,
  builderTable,
  builderColumns,
  builderLimit,
  onCubeChange,
  onMeasureChange,
  onDimensionToggle,
  onBuildSemanticSql,
  onBuilderTableChange,
  onToggleColumn,
  onBuilderLimitChange,
  onBuildSql
}: Props) => {
  const hasSemantic = semanticModel && semanticModel.cubes.length > 0;

  return (
    <section className="panel split">
      {hasSemantic ? (
        <div>
          <div className="panel-header">
            <h2>Semantic builder</h2>
            <div className="panel-header-actions">
              <span className="muted panel-step">3 · Build</span>
              <button type="button" className="button ghost" onClick={onBuildSemanticSql}>
                Generate SQL
              </button>
            </div>
          </div>
          <div className="builder">
            <label>
              Cube
              <select
                value={selectedCube?.name ?? ""}
                onChange={(e) => {
                  const cube = semanticModel!.cubes.find((c) => c.name === e.target.value) ?? null;
                  onCubeChange(cube);
                }}
              >
                {semanticModel!.cubes.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
            {selectedCube ? (
              <>
                <label>
                  Measure
                  <select value={selectedMeasure} onChange={(e) => onMeasureChange(e.target.value)}>
                    {selectedCube.measures.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} ({m.type})
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <p className="status-title" style={{ marginBottom: 8 }}>Dimensions</p>
                  <div className="builder-columns">
                    {selectedCube.dimensions.map((d) => (
                      <label key={d.name} className="checkbox">
                        <input
                          type="checkbox"
                          checked={selectedDimensions.includes(d.name)}
                          onChange={() => onDimensionToggle(d.name)}
                        />
                        <span>{d.name}</span>
                        <span className="muted" style={{ marginLeft: 4 }}>{d.type}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <div>
        <div className="panel-header">
          <h2>Visual builder</h2>
          <div className="panel-header-actions">
            {!hasSemantic ? <span className="muted panel-step">3 · Build</span> : null}
            <button type="button" className="button ghost" onClick={onBuildSql}>
              Build SQL
            </button>
          </div>
        </div>
        <div className="builder">
          <label>
            Table
            <select
              value={builderTable ?? ""}
              onChange={(e) => onBuilderTableChange(e.target.value)}
            >
              <option value="" disabled>
                Select a table
              </option>
              {schemaTables.map((table) => (
                <option key={table} value={table}>
                  {table}
                </option>
              ))}
            </select>
          </label>
          <label>
            Limit
            <input
              type="number"
              min={1}
              value={builderLimit}
              onChange={(e) => onBuilderLimitChange(Number(e.target.value))}
            />
          </label>
          <div className="builder-columns">
            {tableColumns.length ? (
              tableColumns.map((column) => (
                <label key={column.name} className="checkbox">
                  <input
                    type="checkbox"
                    checked={builderColumns.includes(column.name)}
                    onChange={() => onToggleColumn(column.name)}
                  />
                  <span>{column.name}</span>
                </label>
              ))
            ) : (
              <p className="muted">Select a table to choose columns.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default BuildersPanel;
