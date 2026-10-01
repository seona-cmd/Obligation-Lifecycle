import type { Dispatch } from 'react';
import { methodOf, type Action, type State } from '../engine';

interface Props {
  state: State;
  dispatch: Dispatch<Action>;
}

const money = (n: number) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function PaymentsPanel({ state, dispatch }: Props) {
  const { db } = state;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Payments</h2>
          <span className="muted small">One row per payment. A payment can settle several planned transactions.</span>
        </div>
      </div>

      {db.payments.length === 0 ? <p className="hint">No payments yet. Tick billed rows above and choose a method.</p> : (
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr><th>#</th><th>Method</th><th>Date</th><th className="num">Amount</th><th>Status</th><th>Pays</th><th>Bank file</th><th /></tr>
            </thead>
            <tbody>
              {[...db.payments].reverse().map((pay) => {
                const lines = db.payment_transactions.filter((l) => l.payment_id === pay.id && !l.is_reversal);
                const booked = pay.scheduled_transaction_id
                  ? db.scheduled_transaction_items.filter((i) => i.scheduled_transaction_id === pay.scheduled_transaction_id)
                  : [];
                const pays = (lines.length ? lines.map((l) => `#${l.planned_transaction_id} ${Number(l.amount).toFixed(2)}`)
                  : booked.map((i) => `#${i.planned_transaction_id} ${Number(i.requested_amount).toFixed(2)}`)).join(', ');
                const isAch = pay.workflow_type === 'SCHEDULED';
                const file = lines.find((l) => l.ach_file_id)?.ach_file_id;
                const touched = state.touchedRows.includes(`payments:${pay.id}`) || state.touchedCells.some((c) => c.startsWith(`payments:${pay.id}:`));
                return (
                  <tr key={pay.id} className={touched ? 'touched' : ''}>
                    <td className="mono muted">{pay.id}</td>
                    <td><span className={`method-tag mt-${String(pay._method ?? 'ACH').toLowerCase()}`}>{methodOf(pay)}</span></td>
                    <td className="dcell">{pay.effective_date}</td>
                    <td className="num strong">{money(pay.total_amount)}</td>
                    <td><span className={`pstatus ps-${String(pay.status).toLowerCase()}`}>{pay.status}</span></td>
                    <td className="mono small">{pays}</td>
                    <td className="small">{isAch ? (file ? `NACHA #${file}` : pay.status === 'SCHEDULED' ? 'waiting for date' : '–') : '–'}</td>
                    <td className="row-actions">
                      {pay.status === 'SCHEDULED' && <span className="muted small">placeholder for ACH booking #{pay.scheduled_transaction_id}</span>}
                      {pay.status === 'POSTED' && (
                        <button className="small warn" onClick={() => dispatch({ type: 'rescind', paymentId: pay.id })} title="We reverse the payment (refund or restore the balance)">Rescind</button>
                      )}
                      {pay.status === 'POSTED' && isAch && (
                        <button className="small warn" onClick={() => dispatch({ type: 'reject', paymentId: pay.id })} title="The bank returned the ACH debit">Reject (bank return)</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="legend-row">
        <span><b>Rescind</b>: we reverse a posted payment. An ACH debit that already went to the bank is refunded with a NACHA credit. Open account, surplus and CMA payments put the money back in that account.</span>
        <span><b>Reject</b>: the bank returned the ACH debit. The payment is reversed and nothing is refunded.</span>
      </div>
    </section>
  );
}
