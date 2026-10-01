import type { Dispatch } from 'react';
import type { Action, State } from '../engine';
import { GL_ACCOUNTS, GL_RULES } from '../glRules';

const CATS = ['INTEREST', 'FEE', 'PRINCIPAL'] as const;

/** Which event_type each flow step posts, per category. */
const ROWS: { label: string; sub: string; event: (c: (typeof CATS)[number]) => string }[] = [
  { label: 'Bill recognition', sub: 'billed', event: (c) => `${c}_BILL` },
  { label: 'Cash posting / ACH', sub: 'cash in', event: (c) => `${c}_SETTLE` },
  { label: 'Dealer open account', sub: 'internal', event: () => 'DEALER_CREDIT_APPLY' },
  { label: 'Surplus account', sub: 'internal', event: () => 'SURPLUS_APPLY' },
  { label: 'CMA account', sub: 'internal', event: () => 'CMA_HOLDING_APPLY' },
  { label: 'Waive', sub: 'relief', event: () => 'WAIVE' },
  { label: 'Write off', sub: 'relief', event: () => 'WRITE_OFF' },
];

export default function GlDesign({ state, dispatch }: { state: State; dispatch: Dispatch<Action> }) {
  const unexported = state.db.gl_accrual_leg.concat(state.db.gl_cash_movement_leg).filter((l) => l.export_batch_id == null).length;
  // event_type + category of the legs the last action wrote
  const touchedLegs = new Set<string>();
  const touchedAccounts = new Set<string>();
  const plannedCat = (id: number) => state.db.loan_planned_transactions.find((p) => p.id === id)?.category;
  for (const t of ['gl_accrual_leg', 'gl_cash_movement_leg']) {
    for (const l of state.db[t]) {
      if (!state.touchedRows.includes(`${t}:${l.id}`) || l.is_reversal) continue;
      touchedAccounts.add(l.gl_account_code);
      const ptx = l.payment_transaction_id ? state.db.payment_transactions.find((x) => x.id === l.payment_transaction_id) : null;
      const cat = plannedCat(l.planned_transaction_id ?? ptx?.planned_transaction_id);
      if (cat) touchedLegs.add(`${l.event_type}:${cat}`);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>GL account design</h2>
          <span className="muted small">Which account each step debits and credits · <mark>yellow</mark> = posted by the last action</span>
        </div>
        <div className="head-actions">
          <button className="primary" onClick={() => dispatch({ type: 'glExport' })}>
            Run GL export <small>{unexported ? `${unexported} entries not exported` : 'all exported'}</small>
          </button>
        </div>
      </div>
      <div className="gl-grid">
        <div>
          <table className="matrix">
            <thead>
              <tr><th>Step</th>{CATS.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.label}>
                  <th><div>{r.label}</div><span className="muted small">{r.sub}</span></th>
                  {CATS.map((c) => {
                    const ev = r.event(c);
                    const [dr, cr] = GL_RULES[ev][c];
                    return (
                      <td key={c} className={touchedLegs.has(`${ev}:${c}`) ? 'hit' : ''}>
                        <div className="drcr"><span className="dr">DR</span><code>{dr}</code><span className="acct">{GL_ACCOUNTS[dr].name}</span></div>
                        <div className="drcr"><span className="cr">CR</span><code>{cr}</code><span className="acct">{GL_ACCOUNTS[cr].name}</span></div>
                        <div className="ev">{ev}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="gl-explain">
          <h4>How to read it</h4>
          <ul>
            <li><b>Billing</b> debits a clearing account (<code>4200</code> interest, <code>4301</code> fee) and credits income. Principal moves from the loan receivable <code>2500</code> to current-due <code>2520</code>.</li>
            <li><b>Paying</b> credits that same clearing or current-due account, so once an obligation is fully paid its clearing balance is back to zero.</li>
            <li>The <b>debit side shows who paid</b>: <code>1000</code> cash for cash posting and ACH. For the internal methods it is a liability the dealer already holds with us: open account <code>2700</code>, surplus <code>2600</code>, CMA <code>2820</code>.</li>
            <li><b>Waive / write off</b>: nobody pays. The clearing account is closed against a contra-income or loss account.</li>
            <li>Only cash payments also write the cash book. Internal methods and relief write only the accrual book.</li>
            <li>At export, each internal code is mapped to the partner's own GL account.</li>
          </ul>
          <h4>Accounts</h4>
          <table className="accounts">
            <tbody>
              {Object.entries(GL_ACCOUNTS).map(([code, a]) => (
                <tr key={code} className={touchedAccounts.has(code) ? 'hit' : ''}>
                  <td><code>{code}</code></td><td>{a.name}</td><td className="muted small">{a.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
