import { useState, type Dispatch } from 'react';
import {
  billBlocker, invoiceFor, itemsBlocker, METHODS, payBlocker, r2, remaining, scheduledAmount, stageOf,
  type Action, type PayItem, type PayMethod, type Row, type State,
} from '../engine';
import Modal from './Modal';

interface Props {
  state: State;
  dispatch: Dispatch<Action>;
  onNewPlanned: () => void;
}

const fmt = (n: number) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const money = (n: number | null | undefined) => (n == null ? '–' : fmt(n));

export default function PlannedTable({ state, dispatch, onNewPlanned }: Props) {
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [invoiceOf, setInvoiceOf] = useState<Row | null>(null);
  const [achDate, setAchDate] = useState<string>('');
  const rows = state.db.loan_planned_transactions;
  const due = rows.filter((p) => !billBlocker(state, p)).length;
  const effectiveAchDate = achDate && achDate >= state.businessDate ? achDate : state.businessDate;

  // Drop picks that are no longer payable (e.g. after a payment).
  const items: PayItem[] = Object.entries(picked)
    .map(([id, amt]) => ({ id: Number(id), amount: r2(Number(amt)) }))
    .filter((it) => !payBlocker(state, rows.find((p) => p.id === it.id)!));
  const why = itemsBlocker(state, items);
  const total = r2(items.reduce((a, i) => a + (Number.isFinite(i.amount) ? i.amount : 0), 0));

  function toggle(p: Row) {
    const next = { ...picked };
    if (next[p.id] !== undefined) delete next[p.id];
    else next[p.id] = remaining(state, p).toFixed(2);
    setPicked(next);
  }
  function submit(action: Action) {
    dispatch(action);
    setPicked({});
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Planned transactions</h2>
          <span className="muted small">Loan L-1001 · Dealer D-042 · tick billed rows to pay them</span>
        </div>
        <div className="head-actions">
          <button className="ghost" onClick={onNewPlanned}>+ New planned transaction</button>
          <button className="primary" onClick={() => dispatch({ type: 'billRecognition' })} title="Bills every planned row whose invoice / bill date has arrived">
            Run bill recognition <small>{due ? `${due} due today` : 'nothing due today'}</small>
          </button>
        </div>
      </div>

      <div className="scroll">
        <table className="grid">
          <thead>
            <tr>
              <th />
              <th>#</th><th>Category</th>
              <th>Invoice date</th><th>Bill date</th><th>Due date</th>
              <th>Status</th>
              <th className="num">Billed</th><th className="num">Remaining</th>
              <th className="row-actions" />
            </tr>
          </thead>
          {rows.map((p) => {
            const stage = stageOf(p);
            const blocked = payBlocker(state, p);
            const billWhy = billBlocker(state, p);
            const on = picked[p.id] !== undefined && !blocked;
            const touched = state.touchedCells.some((c) => c.startsWith(`loan_planned_transactions:${p.id}:`))
              || state.touchedRows.includes(`loan_planned_transactions:${p.id}`);
            const sched = scheduledAmount(state, p);
            const rem = p.status === 'BILLED' ? remaining(state, p) : null;
            const open = p.status === 'BILLED'
              ? r2(Number(p.billed_total_amount) - Number(p.amount_paid) - Number(p.amount_waived) - Number(p.amount_written_off)) : 0;
            const pastDue = p.status === 'BILLED' && p.due_date < state.businessDate ? open : 0;
            const stats: [string, number, string][] = [
              ['Paid', Number(p.amount_paid), 'paid'],
              ['Waived', Number(p.amount_waived), 'relief'],
              ['Written off', Number(p.amount_written_off), 'relief'],
              ['Scheduled (ACH)', sched, 'sched'],
              ['Past due', pastDue, 'overdue'],
            ];
            return (
              <tbody key={p.id} className={`prow ${touched ? 'touched' : ''} ${on ? 'picked' : ''}`}>
                <tr className="main">
                  <td rowSpan={2}><input type="checkbox" checked={on} disabled={!!blocked} title={blocked ?? 'Select to pay'} onChange={() => toggle(p)} /></td>
                  <td className="mono muted">{p.id}</td>
                  <td><span className={`cat cat-${String(p.category).toLowerCase()}`}>{p.category}</span></td>
                  <td className="dcell">{p.invoice_date}</td>
                  <td className="dcell">{p.bill_date}</td>
                  <td className={`dcell ${pastDue ? 'overdue' : ''}`}>{p.due_date}</td>
                  <td><span className={`stage-badge st-${stage.replace(' ', '-').toLowerCase()}`}>{stage}</span></td>
                  <td className={`num big ${p.billed_total_amount != null ? 'billed' : ''}`}>
                    {p.billed_total_amount != null ? fmt(p.billed_total_amount) : <span className="forecast" title="Planned amount, not billed yet">{fmt(p.amount)}</span>}
                  </td>
                  <td className="num big remaining">{rem == null ? <span className="zero">–</span> : <span className={rem ? '' : 'zero'}>{fmt(rem)}</span>}</td>
                  <td className="row-actions" rowSpan={2}>
                    {p.status === 'PROJECTED' && (
                      <button className="small" disabled={!!billWhy} title={billWhy ?? 'Bill this row now'} onClick={() => dispatch({ type: 'billOne', id: p.id })}>Bill</button>
                    )}
                    {invoiceFor(state, p) && <button className="small" onClick={() => setInvoiceOf(p)}>Invoice</button>}
                  </td>
                </tr>
                <tr className="sub">
                  <td />
                  <td colSpan={7}>
                    <div className="stats">
                      {p.status === 'PROJECTED'
                        ? <span className="muted small">{billWhy ?? 'Due for billing'} · nothing can be paid until it is billed</span>
                        : stats.map(([label, n, tone]) => (
                          <span key={label} className={`stat ${n ? tone : 'is-zero'}`}><span>{label}</span><b>{fmt(n)}</b></span>
                        ))}
                    </div>
                  </td>
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>

      <div className={`paybox ${items.length ? 'active' : ''}`}>
        <div className="paybox-left">
          <h3>Pay {items.length ? `${items.length} row(s)` : ''}</h3>
          {items.length === 0 ? (
            <p className="hint">Tick one or more <b>billed</b> rows in the table. They show up here, where you can change how much to pay on each.</p>
          ) : (
            <>
              <table className="paylist">
                <thead><tr><th>Row</th><th className="num">Left to pay</th><th className="num">Pay now</th><th /></tr></thead>
                <tbody>
                  {items.map((it) => {
                    const p = rows.find((x) => x.id === it.id)!;
                    return (
                      <tr key={it.id}>
                        <td><span className={`cat cat-${String(p.category).toLowerCase()}`}>{p.category}</span> <span className="muted mono">#{p.id}</span></td>
                        <td className="num">{fmt(remaining(state, p))}</td>
                        <td className="num">
                          <span className="amt-wrap">$<input className="amt" type="text" inputMode="decimal" value={picked[it.id]}
                            onChange={(e) => setPicked({ ...picked, [it.id]: e.target.value.replace(/[^0-9.]/g, '') })} /></span>
                        </td>
                        <td><button className="icon" title="Remove" onClick={() => toggle(p)}>×</button></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr><td>Total</td><td /><td className="num">{fmt(total)}</td><td /></tr></tfoot>
              </table>
              <div className={why ? 'why' : 'ok'}>{why ?? 'Ready: this will be one payment with one payment line per row.'}</div>
            </>
          )}
        </div>

        <div className="paybox-options">
          <div className="opt opt-rt">
            <div className="opt-head"><h4>Realtime</h4><span>posted immediately</span></div>
            <p>Same flow for all four; only cash posting moves real money.</p>
            <div className="opt-buttons two">
              {(['CASH', 'OPEN_ACCOUNT', 'SURPLUS', 'CMA_HOLDING'] as PayMethod[]).map((k) => (
                <button key={k} disabled={!!why} onClick={() => submit({ type: 'pay', method: k, items })}>
                  {METHODS[k].label}
                  <small>{k === 'CASH' ? 'cash received' : `balance ${fmt(state.balances[k as 'SURPLUS'])}`}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="opt opt-ach">
            <div className="opt-head"><h4>ACH</h4><span>booked for a date</span></div>
            <p>Nothing is paid now. On the date, the 17:00 run posts it and sends a NACHA file to the bank.</p>
            <label className="opt-field">ACH date
              <input type="date" min={state.businessDate} value={effectiveAchDate} onChange={(e) => setAchDate(e.target.value)} />
            </label>
            <button className="opt-main" disabled={!!why} onClick={() => submit({ type: 'scheduleAch', items, effectiveDate: effectiveAchDate })}>
              Schedule ACH
            </button>
          </div>

          <div className="opt opt-relief">
            <div className="opt-head"><h4>Relief</h4><span>nobody pays</span></div>
            <p>Reduces what is owed without money: waived or written off.</p>
            <div className="opt-buttons">
              {(['WAIVE', 'WRITE_OFF'] as PayMethod[]).map((k) => (
                <button key={k} disabled={!!why} onClick={() => submit({ type: 'pay', method: k, items })}>{METHODS[k].label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {invoiceOf && (() => {
        const inv = invoiceFor(state, invoiceOf)!;
        const p = rows.find((x) => x.id === invoiceOf.id)!;
        return (
          <Modal title={`Invoice ${inv.invoice_number}`} onClose={() => setInvoiceOf(null)}>
            <div className="invoice-doc">
              <div className="inv-row"><span>Bill to</span><b>Dealer D-042</b></div>
              <div className="inv-row"><span>Loan</span><b>L-1001</b></div>
              <div className="inv-row"><span>Invoice date</span><b>{inv.invoice_date}</b></div>
              <div className="inv-row"><span>Due date</span><b>{inv.due_date}</b></div>
              <table className="inv-lines">
                <thead><tr><th>Description</th><th className="num">Amount</th></tr></thead>
                <tbody><tr><td>{inv.category} · planned transaction #{inv.planned_transaction_id}</td><td className="num">{money(inv.invoice_amount)}</td></tr></tbody>
                <tfoot><tr><td>Total due</td><td className="num">{money(inv.invoice_amount)}</td></tr></tfoot>
              </table>
              <div className="inv-meta">
                <span>Status <b>{inv.status}</b></span>
                <span>Settled so far <b>{money(Number(p.amount_paid) + Number(p.amount_waived) + Number(p.amount_written_off))}</b></span>
              </div>
              <p className="hint">One invoice per planned transaction. It is issued in the same step as the bill.</p>
            </div>
          </Modal>
        );
      })()}
    </section>
  );
}
