import type { State } from '../engine';
import TableChip from './TableChip';

interface Props {
  state: State;
  touched: Set<string>;
}

/** The big picture. Purely explanatory: the buttons live in the panels below. */
export default function FlowDiagram({ state, touched }: Props) {
  const chip = (t: string, note?: string) => <TableChip table={t} count={state.db[t].length} touched={touched.has(t)} note={note} />;

  return (
    <section className="flow">
      <div className="stage s-plan">
        <div className="stage-head"><span className="stage-num">1</span><h3>Planned</h3><span className="status-pill">PROJECTED</span></div>
        <p className="stage-desc">What the dealer will owe and when. One row per interest, principal or fee. No money and no accounting yet.</p>
        <div className="chips">{chip('loan_planned_transactions')}</div>
      </div>

      <div className="connector"><span>bill</span><b>→</b></div>

      <div className="stage s-bill">
        <div className="stage-head"><span className="stage-num">2</span><h3>Billed</h3><span className="status-pill">BILLED</span></div>
        <p className="stage-desc">On the bill date (or earlier, the invoice date) the obligation is recognised. In one step this writes the bill, issues the invoice and posts the accounting entry.</p>
        <div className="chips">{chip('bill_transactions')}{chip('invoice')}{chip('gl_accrual_leg', 'recognition')}</div>
        <div className="callout">Only billed rows can be paid.</div>
      </div>

      <div className="connector"><span>pay</span><b>→</b></div>

      <div className="stage s-pay">
        <div className="stage-head"><span className="stage-num">3</span><h3>Paid</h3></div>
        <div className="lanes">
          <div className="lane lane-rt">
            <h4>Realtime: posted at once</h4>
            <p className="stage-desc">Cash posting, dealer open account, surplus account and CMA account all run the same flow. Only cash posting moves real money. The other three draw down a balance the dealer holds with us.</p>
            <div className="chips">{chip('payments')}{chip('payment_transactions')}{chip('gl_accrual_leg', 'settlement')}{chip('gl_cash_movement_leg', 'cash only')}</div>
            <div className="chips">{chip('dealer_credit_movement')}{chip('surplus_movement')}{chip('cma_movement')}</div>
          </div>
          <div className="lane lane-ach">
            <h4>ACH: booked for a date</h4>
            <p className="stage-desc">Booking writes an ACH booking and a placeholder payment. On the ACH date the daily run posts it and puts it in a NACHA file for the bank.</p>
            <div className="chips">{chip('scheduled_transactions')}{chip('scheduled_transaction_items')}</div>
            <div className="chips">{chip('outbound_transactions')}{chip('ach_files')}{chip('ach_entries')}</div>
          </div>
        </div>
      </div>

      <div className="flow-foot">
        <span className="stage-num small">GL</span>
        <span>Every billing and payment step writes balanced journal entries. These are exported to the general ledger daily.</span>
        <div className="chips">{chip('gl_accrual_leg')}{chip('gl_cash_movement_leg')}{chip('gl_export_batch')}</div>
      </div>
    </section>
  );
}
