import { useState } from 'react';
import type { State } from '../engine';
import { FAMILY_LABEL, TABLES, type Family } from '../schema';

function fmt(v: unknown) {
  if (v === null || v === undefined) return <span className="muted">NULL</span>;
  if (typeof v === 'number' && !Number.isInteger(v)) return v.toFixed(2);
  return String(v);
}

export default function TablesPanel({ state }: { state: State }) {
  const [hideEmpty, setHideEmpty] = useState(true);
  const rowsTouched = new Set(state.touchedRows);
  const cellsTouched = new Set(state.touchedCells);
  const families = [...new Set(TABLES.map((t) => t.family))] as Family[];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Database tables</h2>
        <label className="check small">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> hide empty tables
        </label>
      </div>
      <p className="hint"><mark>Yellow</mark> = written by the last action. Everything is simulated in the browser; no real database is touched.</p>
      {families.map((f) => {
        const defs = TABLES.filter((t) => t.family === f && !(hideEmpty && !state.db[t.name].length));
        if (!defs.length) return null;
        return (
          <div key={f} className="fam">
            <h3 className={`fam-title fam-${f}`}>{FAMILY_LABEL[f]}</h3>
            {defs.map((t) => {
              const rows = state.db[t.name];
              return (
                <div key={t.name} id={`t-${t.name}`} className={`tbl fam-${t.family}`}>
                  <div className="tbl-head" title={t.name}><b>{t.label}</b><span className="muted">{t.about}</span><span className="count">{rows.length}</span></div>
                  {rows.length ? (
                    <div className="scroll">
                      <table>
                        <thead><tr>{t.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id} className={rowsTouched.has(`${t.name}:${r.id}`) ? 'new' : ''}>
                              {t.columns.map((c) => (
                                <td key={c} className={cellsTouched.has(`${t.name}:${r.id}:${c}`) ? 'chg' : ''}>{fmt(r[c])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <div className="none">no rows yet</div>}
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
