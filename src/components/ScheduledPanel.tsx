import type { Dispatch } from 'react';
import type { Action, State } from '../engine';

interface Props {
  state: State;
  dispatch: Dispatch<Action>;
}

const money = (n: number) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** ACH bookings (scheduled_transactions): an instruction to collect on a date. */
export default function ScheduledPanel({ state, dispatch }: Props) {
  const { db } = state;
  const today = db.scheduled_transactions.filter((s) => s.status === 'SCHEDULED' && s.effective_date === state.businessDate).length;
  const pending = db.outbound_transactions.filter((o) => o.status === 'PENDING').length;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Scheduled transactions (ACH)</h2>
          <span className="muted small">An ACH booking only says what to collect, and on which date. It becomes a posted payment in the 17:00 ACH run on that date.</span>
        </div>
        <div className="head-actions">
          <button className="primary" onClick={() => dispatch({ type: 'generateNacha' })}
            title="The 17:00 run: posts bookings dated today and writes the NACHA file">
            Run ACH + NACHA <small>{today ? `${today} booking(s) dated today` : pending ? `${pending} pending instruction(s)` : 'nothing dated today'}</small>
          </button>
        </div>
      </div>
      {db.scheduled_transactions.length === 0 ? (
        <p className="hint">No ACH bookings yet. Tick billed rows above, choose a date and press Schedule ACH.</p>
      ) : (
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr><th>#</th><th>ACH date</th><th className="num">Amount</th><th>Status</th><th>Collects</th><th>Payment</th><th className="row-actions" /></tr>
            </thead>
            <tbody>
              {[...db.scheduled_transactions].reverse().map((st) => {
                const items = db.scheduled_transaction_items.filter((i) => i.scheduled_transaction_id === st.id);
                const pay = db.payments.find((p) => p.scheduled_transaction_id === st.id);
                const touched = state.touchedRows.includes(`scheduled_transactions:${st.id}`)
                  || state.touchedCells.some((c) => c.startsWith(`scheduled_transactions:${st.id}:`));
                const isToday = st.effective_date === state.businessDate;
                return (
                  <tr key={st.id} className={touched ? 'touched' : ''}>
                    <td className="mono muted">{st.id}</td>
                    <td className="dcell">{st.effective_date}{st.status === 'SCHEDULED' && <span className="when">{isToday ? 'today 17:00' : 'future'}</span>}</td>
                    <td className="num strong">{money(st.total_amount)}</td>
                    <td><span className={`pstatus ps-${String(st.status).toLowerCase()}`}>{st.status}</span></td>
                    <td className="mono small">{items.map((i) => `#${i.planned_transaction_id} ${Number(i.requested_amount).toFixed(2)}`).join(', ')}</td>
                    <td className="small">{pay ? `#${pay.id} · ${pay.status}` : '–'}</td>
                    <td className="row-actions">
                      {st.status === 'SCHEDULED' && pay && (
                        <button className="small" onClick={() => dispatch({ type: 'unschedule', paymentId: pay.id })} title="Cancel before the ACH date">Unschedule</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
