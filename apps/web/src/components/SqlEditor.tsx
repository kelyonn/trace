import { useMemo, useRef } from "react";

const KEYWORDS = new Set(
  (
    "select from where group by order having limit offset join left right inner outer full cross on as and or not " +
    "in is null case when then else end with union all distinct asc desc between like ilike exists interval explain " +
    "over partition window rows range filter cast true false"
  ).split(" ")
);
const FUNCTIONS = new Set(
  "sum count avg min max round date_trunc coalesce extract lower upper concat length abs floor ceil now date_diff rank row_number lag lead nullif".split(
    " "
  )
);

type Token = { text: string; cls?: string };

export function tokenizeSql(sql: string): Token[] {
  const re = /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\sA-Za-z0-9_']+)/g;
  const out: Token[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    if (m[1]) out.push({ text: m[1], cls: "tok-com" });
    else if (m[2]) out.push({ text: m[2], cls: "tok-str" });
    else if (m[3]) out.push({ text: m[3], cls: "tok-num" });
    else if (m[4]) {
      const lower = m[4].toLowerCase();
      if (KEYWORDS.has(lower)) out.push({ text: m[4], cls: "tok-kw" });
      else if (FUNCTIONS.has(lower) && sql[re.lastIndex] === "(") out.push({ text: m[4], cls: "tok-fn" });
      else out.push({ text: m[4] });
    } else out.push({ text: m[0] });
  }
  return out;
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  footer?: React.ReactNode;
  minRows?: number;
};

const SqlEditor = ({ value, onChange, onRun, footer, minRows = 6 }: Props) => {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const tokens = useMemo(() => tokenizeSql(value), [value]);
  const lines = Math.max(minRows, value.split("\n").length);
  const minHeight = lines * 20.8 + 24;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onRun?.();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart, selectionEnd } = ta;
      const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = selectionStart + 2;
      });
    }
  };

  return (
    <div className="editor">
      <div className="editor-inner">
        <div className="editor-code" style={{ minHeight }}>
          <pre aria-hidden>
            {tokens.map((t, i) =>
              t.cls ? (
                <span key={i} className={t.cls}>
                  {t.text}
                </span>
              ) : (
                t.text
              )
            )}
            {"\n"}
          </pre>
          <textarea
            ref={taRef}
            spellCheck={false}
            aria-label="SQL editor"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
      {footer ? <div className="editor-footer">{footer}</div> : null}
    </div>
  );
};

export default SqlEditor;
