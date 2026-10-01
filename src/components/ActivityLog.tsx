import type { LogEntry } from '../engine';

interface Props {
  log: LogEntry[];
  open: boolean;
  onToggle: () => void;
}

/** Left sidebar: newest first. Collapses to a thin rail. */
export default function ActivityLog({ log, open, onToggle }: Props) {
  if (!open) {
    return (
      <aside className="sidebar collapsed">
        <button className="rail" onClick={onToggle} title="Show what just happened">
          <span className="rail-icon">»</span>
          <span className="rail-text">What just happened</span>
          {log.length > 0 && <span className="rail-dot" />}
        </button>
      </aside>
    );
  }
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <h2>What just happened</h2>
        <button className="icon" onClick={onToggle} title="Hide">«</button>
      </div>
      <div className="log">
        {log.map((e, i) => (
          <div key={log.length - i} className={`entry ${e.error ? 'err' : ''} ${i === 0 ? 'latest' : ''}`}>
            <div className="title">{e.title} <span className="mono muted">{e.businessDate}</span></div>
            {e.items.length > 0 && <ul>{e.items.map((it, j) => <li key={j}>{it}</li>)}</ul>}
          </div>
        ))}
      </div>
    </aside>
  );
}
