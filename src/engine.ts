/**
 * In-browser model of how VeroLMS writes its transaction records. Rules mirror
 * temporal-worker-service: billTransaction.service (bill recognition), invoiceDate (lead
 * days), configurationWrites.activities (Pay now guards), executeRealtimePayment.workflow,
 * dealerCredit / cmaApply workflows (internal settlement sources), paymentTransaction.service
 * (settleScheduledTransaction), achScheduledExecution (NACHA), reversal.service (rescind /
 * reject) and glLeg.service. Pricing, GL accounts and bank cut-offs are simplified.
 */
import { TABLES } from './schema';
import { accountFor } from './glRules';

export type Row = Record<string, any> & { id: number };
export type Category = 'INTEREST' | 'PRINCIPAL' | 'FEE';
export type RealtimeSource = 'CASH' | 'OPEN_ACCOUNT' | 'SURPLUS' | 'CMA_HOLDING';
export type Relief = 'WAIVE' | 'WRITE_OFF';
export type PayMethod = RealtimeSource | Relief;
type Holding = Exclude<RealtimeSource, 'CASH'>;

export interface LogEntry {
  title: string;
  items: string[];
  error: boolean;
  businessDate: string;
}

export interface State {
  businessDate: string;
  db: Record<string, Row[]>;
  seq: Record<string, number>;
  invoiceSeq: number;
  balances: Record<Holding, number>;
  log: LogEntry[];
  touchedRows: string[];
  touchedCells: string[];
}

export interface NewPlanned {
  category: Category;
  amount: number;
  billDate: string;
  dueDate: string;
  earlyInvoicing: boolean;
  leadDays: number;
}

export interface PayItem {
  id: number;
  amount: number;
}

export type Action =
  | { type: 'reset' }
  | { type: 'advance'; days: number }
  | { type: 'addPlanned'; row: NewPlanned }
  | { type: 'billRecognition'; auto?: boolean }
  | { type: 'billOne'; id: number }
  | { type: 'pay'; method: PayMethod; items: PayItem[] }
  | { type: 'scheduleAch'; items: PayItem[]; effectiveDate: string }
  | { type: 'generateNacha'; auto?: boolean }
  | { type: 'glExport'; auto?: boolean }
  | { type: 'unschedule'; paymentId: number }
  | { type: 'rescind'; paymentId: number }
  | { type: 'reject'; paymentId: number };

export const METHODS: Record<PayMethod, { label: string; holding?: string; kind: 'cash' | 'internal' | 'relief' }> = {
  CASH: { label: 'Cash posting', kind: 'cash' },
  OPEN_ACCOUNT: { label: 'Dealer open account', holding: 'dealer_credit_movement', kind: 'internal' },
  SURPLUS: { label: 'Surplus account', holding: 'surplus_movement', kind: 'internal' },
  CMA_HOLDING: { label: 'CMA account', holding: 'cma_movement', kind: 'internal' },
  WAIVE: { label: 'Waive', kind: 'relief' },
  WRITE_OFF: { label: 'Write off', kind: 'relief' },
};

const START = '2026-10-01';

// ------------------------------------------------------------------ dates and numbers
export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const minYmd = (a: string, b: string) => (a < b ? a : b);
export const r2 = (n: number) => Math.round(n * 100) / 100;

const BILL_EVENT: Record<Category, string> = { INTEREST: 'INTEREST_BILL', FEE: 'FEE_BILL', PRINCIPAL: 'PRINCIPAL_BILL' };
const SETTLE_EVENT: Record<Category, string> = { INTEREST: 'INTEREST_SETTLE', FEE: 'FEE_SETTLE', PRINCIPAL: 'PRINCIPAL_SETTLE' };
/** glLeg.service deriveAccrualSettlementLegs: internal sources and relief use their own posting rule. */
const OWN_EVENT: Partial<Record<PayMethod, string>> = {
  OPEN_ACCOUNT: 'DEALER_CREDIT_APPLY', SURPLUS: 'SURPLUS_APPLY', CMA_HOLDING: 'CMA_HOLDING_APPLY', WAIVE: 'WAIVE', WRITE_OFF: 'WRITE_OFF',
};

// ------------------------------------------------------------------ write helpers
class Tx {
  constructor(public s: State) {}

  insert(t: string, row: Record<string, any>): Row {
    const r = { id: ++this.s.seq[t], ...row } as Row;
    this.s.db[t].push(r);
    this.s.touchedRows.push(`${t}:${r.id}`);
    return r;
  }

  set(t: string, row: Row, patch: Record<string, any>) {
    for (const k of Object.keys(patch)) {
      if (row[k] !== patch[k]) {
        row[k] = patch[k];
        this.s.touchedCells.push(`${t}:${row.id}:${k}`);
      }
    }
  }

  get(t: string, id: number): Row {
    return this.s.db[t].find((r) => r.id === id)!;
  }

  log(title: string, items: string[] = [], error = false) {
    this.s.log.unshift({ title, items, error, businessDate: this.s.businessDate });
  }

  legs(t: string, journalGroupId: string, eventType: string, category: string, amount: number, extra: Record<string, any>) {
    (['DEBIT', 'CREDIT'] as const).forEach((drCr, i) =>
      this.insert(t, {
        journal_group_id: journalGroupId, leg_no: i + 1, event_type: eventType, dr_cr: drCr,
        gl_account_code: accountFor(eventType, category, drCr), amount, is_reversal: false, export_batch_id: null, ...extra,
      }),
    );
  }
}

// ------------------------------------------------------------------ rules (also used by the UI)
/** invoiceDate.ts: bill_date - lead days, clamped to [tomorrow, bill_date]. Computed when the row is written. */
function resolveInvoiceDate(businessDate: string, billDate: string, early: boolean, lead: number): string {
  if (!early || lead <= 0) return billDate;
  const derived = addDays(billDate, -lead);
  const tomorrow = addDays(businessDate, 1);
  return minYmd(billDate, derived > tomorrow ? derived : tomorrow);
}

export function billBlocker(s: State, p: Row): string | null {
  if (p.status === 'CANCELLED') return 'Cancelled';
  if (p.status === 'BILLED') return 'Already billed';
  const recog = minYmd(p.invoice_date ?? p.bill_date, p.bill_date);
  if (recog > s.businessDate) return `Not due until ${recog}`;
  return null;
}

export function scheduledAmount(s: State, p: Row): number {
  return r2(s.db.scheduled_transaction_items
    .filter((i) => i.planned_transaction_id === p.id && i.status === 'SCHEDULED')
    .reduce((a, i) => a + Number(i.requested_amount), 0));
}

/** planned - paid - waived - written off - already scheduled. */
export function remaining(s: State, p: Row): number {
  return r2(Number(p.billed_total_amount ?? p.amount) - Number(p.amount_paid) - Number(p.amount_waived)
    - Number(p.amount_written_off) - scheduledAmount(s, p));
}

/** isPlannedRowPayable + the amount guard of Pay now. */
export function payBlocker(s: State, p: Row): string | null {
  if (!(p.status === 'BILLED' || p.billed_total_amount != null)) return 'Not billed yet';
  if (remaining(s, p) <= 0) return scheduledAmount(s, p) > 0 ? 'Rest is ACH scheduled' : 'Settled';
  return null;
}

export function invoiceFor(s: State, p: Row): Row | undefined {
  return s.db.invoice.find((i) => i.planned_transaction_id === p.id && i.status === 'ISSUED');
}

function billFor(s: State, p: Row): Row | undefined {
  return [...s.db.bill_transactions].reverse().find((b) => b.planned_transaction_id === p.id && !b.is_reversal);
}

export type Stage = 'Projected' | 'Billed' | 'Partly settled' | 'Settled' | 'Cancelled';
export function stageOf(p: Row): Stage {
  if (p.status === 'CANCELLED') return 'Cancelled';
  if (p.status !== 'BILLED') return 'Projected';
  const settled = Number(p.amount_paid) + Number(p.amount_waived) + Number(p.amount_written_off);
  if (settled >= Number(p.billed_total_amount)) return 'Settled';
  if (settled > 0) return 'Partly settled';
  return 'Billed';
}

/** How a payment is described in the UI. */
export function methodOf(pay: Row): string {
  if (pay.workflow_type === 'SCHEDULED') return 'ACH';
  return METHODS[pay._method as PayMethod]?.label ?? pay.workflow_type;
}

/** Validates the items of one Pay now request. Returns an error or null. */
export function itemsBlocker(s: State, items: PayItem[]): string | null {
  if (!items.length) return 'Tick at least one planned transaction';
  for (const it of items) {
    const p = s.db.loan_planned_transactions.find((x) => x.id === it.id)!;
    const why = payBlocker(s, p);
    if (why) return `#${p.id}: ${why.toLowerCase()}`;
    if (!(it.amount > 0)) return `#${p.id}: amount must be more than 0`;
    if (it.amount > remaining(s, p) + 1e-9) return `#${p.id}: amount is more than the ${remaining(s, p).toFixed(2)} left`;
  }
  return null;
}

// ------------------------------------------------------------------ steps
function writePlanned(tx: Tx, p: NewPlanned): Row {
  return tx.insert('loan_planned_transactions', {
    category: p.category, amount: r2(p.amount),
    invoice_date: resolveInvoiceDate(tx.s.businessDate, p.billDate, p.earlyInvoicing, p.leadDays),
    bill_date: p.billDate, due_date: p.dueDate, status: 'PROJECTED', billed_total_amount: null,
    amount_paid: 0, amount_waived: 0, amount_written_off: 0, reason_code: null,
  });
}

/** recognizeObligationBill: one DB transaction → BILLED + bill_transactions + invoice; then RECOGNITION legs. */
function recognize(tx: Tx, p: Row): string[] {
  const s = tx.s;
  const amount = r2(p.amount);
  if (amount <= 0) {
    tx.set('loan_planned_transactions', p, { status: 'CANCELLED', reason_code: 'ZERO_ACCRUAL' });
    return [`#${p.id}: amount is 0, so it is CANCELLED (ZERO_ACCRUAL). No bill, no invoice.`];
  }
  const recogDate = p.invoice_date && p.invoice_date < p.bill_date && p.invoice_date <= s.businessDate ? p.invoice_date : p.bill_date;
  tx.set('loan_planned_transactions', p, { status: 'BILLED', billed_total_amount: amount });
  const bill = tx.insert('bill_transactions', {
    planned_transaction_id: p.id, transaction_origin: 'BILL_RECOGNITION', amount, outstanding: amount,
    bill_date: p.bill_date, invoice_date: recogDate, effective_date: recogDate, process_date: s.businessDate,
    status: 'POSTED', is_reversal: false,
  });
  const inv = tx.insert('invoice', {
    invoice_number: `INV-${++s.invoiceSeq}`, planned_transaction_id: p.id, category: p.category,
    invoice_date: recogDate, invoice_amount: amount, due_date: p.due_date, status: 'ISSUED',
  });
  const ev = BILL_EVENT[p.category as Category];
  tx.legs('gl_accrual_leg', `accr-recog-bill-${bill.id}`, ev, p.category, amount, {
    phase: 'RECOGNITION', bill_transaction_id: bill.id, payment_transaction_id: null, planned_transaction_id: p.id,
  });
  const out = [
    `#${p.id} ${p.category} is now BILLED for ${amount}.`,
    `Same step: Bill #${bill.id} and invoice ${inv.invoice_number}.`,
    `GL accrual book: ${ev} (one debit + one credit).`,
  ];
  if (recogDate < p.bill_date) out.push(`Early invoicing: billed on invoice date ${recogDate}; the bill still records bill date ${p.bill_date}.`);
  return out;
}

const AMOUNT_COL: Record<string, string> = { WAIVE: 'amount_waived', WRITE_OFF: 'amount_written_off' };

function postLine(tx: Tx, pay: Row, p: Row, amount: number, o: { origin: string; type: string; source: string | null; itemId: number | null }): Row {
  const ptx = tx.insert('payment_transactions', {
    payment_id: pay.id, planned_transaction_id: p.id, bill_transaction_id: billFor(tx.s, p)?.id ?? null,
    item_id: o.itemId, transaction_origin: o.origin, payment_type: o.type, settlement_source: o.source, amount,
    status: 'POSTED', is_reversal: false, reverses_payment_transaction_id: null, ach_status: null, ach_file_id: null,
  });
  const col = AMOUNT_COL[o.type] ?? 'amount_paid';
  tx.set('loan_planned_transactions', p, { [col]: r2(Number(p[col]) + amount) });
  return ptx;
}

/** GenerateCashMovementLegs (cash only) + GenerateAccrualSettlementLegs. */
function settlementLegs(tx: Tx, ptx: Row, p: Row, method: PayMethod): string {
  const ev = method === 'CASH' ? SETTLE_EVENT[p.category as Category] : OWN_EVENT[method]!;
  if (method === 'CASH') {
    tx.legs('gl_cash_movement_leg', `cash-move-ptx-${ptx.id}`, ev, p.category, ptx.amount, { payment_transaction_id: ptx.id });
  }
  tx.legs('gl_accrual_leg', `accr-settle-ptx-${ptx.id}`, ev, p.category, ptx.amount, {
    phase: 'SETTLEMENT', bill_transaction_id: null, payment_transaction_id: ptx.id, planned_transaction_id: p.id,
  });
  return ev;
}

function holdingMove(tx: Tx, method: PayMethod, direction: 'DEBIT' | 'CREDIT', amount: number, ptx: Row, reversal: boolean): string | null {
  const m = METHODS[method];
  if (!m.holding) return null;
  const k = method as Holding;
  tx.s.balances[k] = r2(tx.s.balances[k] + (direction === 'DEBIT' ? -amount : amount));
  tx.insert(m.holding, {
    direction, amount, balance_after: tx.s.balances[k], planned_transaction_id: ptx.planned_transaction_id,
    payment_transaction_id: ptx.id, payment_id: ptx.payment_id, is_reversal: reversal,
  });
  return m.holding;
}

/** settleScheduledTransaction, for one ACH booking. */
function settleBooking(tx: Tx, st: Row): string[] {
  const s = tx.s;
  const pay = s.db.payments.find((x) => x.scheduled_transaction_id === st.id)!;
  const lines: string[] = [];
  s.db.scheduled_transaction_items
    .filter((i) => i.scheduled_transaction_id === st.id && i.status === 'SCHEDULED')
    .forEach((it) => {
      const p = tx.get('loan_planned_transactions', it.planned_transaction_id);
      const ptx = postLine(tx, pay, p, Number(it.requested_amount), { origin: 'PAYMENT_POSTING', type: 'SCHEDULED', source: 'CASH', itemId: it.id });
      tx.set('scheduled_transaction_items', it, { status: 'PROCESSED' });
      tx.insert('outbound_transactions', { payment_transaction_id: ptx.id, process_type: 'ACH', direction: 'DEBIT', process_date: s.businessDate, status: 'PENDING', outbound_file_id: null });
      settlementLegs(tx, ptx, p, 'CASH');
      lines.push(`#${p.id} ${it.requested_amount}`);
    });
  tx.set('scheduled_transactions', st, { status: 'PROCESSED', processed_at: s.businessDate });
  tx.set('payments', pay, { status: 'POSTED' });
  return [
    `Payment #${pay.id} SCHEDULED → POSTED. Payment lines: ${lines.join(', ')}. Booking and its lines → PROCESSED.`,
    'Each line gets a bank instruction (PENDING) and GL cash + accrual SETTLEMENT entries.',
  ];
}

/** reversal.service: append reversal lines, roll the planned amounts back, reverse the GL. */
function reverseLines(tx: Tx, pay: Row): { ptx: Row; rev: Row }[] {
  const s = tx.s;
  const out: { ptx: Row; rev: Row }[] = [];
  s.db.payment_transactions.filter((x) => x.payment_id === pay.id && !x.is_reversal).forEach((ptx) => {
    const p = tx.get('loan_planned_transactions', ptx.planned_transaction_id);
    const { id: _ptxId, ...rest } = ptx;
    const rev = tx.insert('payment_transactions', {
      ...rest, amount: -ptx.amount, is_reversal: true, reverses_payment_transaction_id: ptx.id, ach_status: null, ach_file_id: null,
    });
    const col = AMOUNT_COL[ptx.payment_type] ?? 'amount_paid';
    tx.set('loan_planned_transactions', p, { [col]: r2(Number(p[col]) - ptx.amount) });
    (['gl_cash_movement_leg', 'gl_accrual_leg'] as const).forEach((t) => {
      const prefix = t === 'gl_cash_movement_leg' ? 'cash-move-ptx-' : 'accr-settle-ptx-';
      s.db[t].filter((l) => l.journal_group_id === prefix + ptx.id && !l.is_reversal).forEach((l) => {
        const { id: _legId, ...legRest } = l;
        tx.insert(t, {
          ...legRest, journal_group_id: `${prefix}${rev.id}`, payment_transaction_id: rev.id,
          dr_cr: l.dr_cr === 'DEBIT' ? 'CREDIT' : 'DEBIT', is_reversal: true, export_batch_id: null,
        });
      });
    });
    out.push({ ptx, rev });
  });
  return out;
}

// ------------------------------------------------------------------ state
export function initialState(): State {
  const db: Record<string, Row[]> = {};
  const seq: Record<string, number> = {};
  TABLES.forEach((t) => { db[t.name] = []; seq[t.name] = 0; });
  const s: State = {
    businessDate: START, db, seq, invoiceSeq: 1000,
    balances: { OPEN_ACCOUNT: 5000, SURPLUS: 1000, CMA_HOLDING: 800 },
    log: [], touchedRows: [], touchedCells: [],
  };
  const tx = new Tx(s);
  writePlanned(tx, { category: 'INTEREST', amount: 82.19, billDate: '2026-10-01', dueDate: '2026-10-11', earlyInvoicing: false, leadDays: 0 });
  writePlanned(tx, { category: 'FEE', amount: 25, billDate: '2026-10-01', dueDate: '2026-10-11', earlyInvoicing: false, leadDays: 0 });
  writePlanned(tx, { category: 'PRINCIPAL', amount: 2500, billDate: '2026-10-05', dueDate: '2026-10-15', earlyInvoicing: true, leadDays: 2 });
  writePlanned(tx, { category: 'INTEREST', amount: 79.45, billDate: '2026-11-01', dueDate: '2026-11-11', earlyInvoicing: false, leadDays: 0 });
  s.touchedRows = [];
  tx.log('A loan with four planned transactions', [
    '#1 INTEREST and #2 FEE are due today. #3 PRINCIPAL uses early invoicing (invoice date 10-03, bill date 10-05). #4 is next month.',
    'All are PROJECTED: nothing is posted and no money has moved.',
    'Start with "Run bill recognition".',
  ]);
  return s;
}

export function reduce(prev: State, action: Action): State {
  if (action.type === 'reset') return initialState();
  const s: State = structuredClone(prev);
  s.touchedRows = [];
  s.touchedCells = [];
  apply(new Tx(s), action);
  return s;
}

function apply(tx: Tx, action: Action): void {
  const s = tx.s;
  switch (action.type) {
    case 'advance': {
      for (let d = 0; d < action.days; d++) {
        const today = s.businessDate;
        const before = s.log.length;
        apply(tx, { type: 'generateNacha', auto: true });          // 17:00 today
        s.businessDate = addDays(today, 1);
        apply(tx, { type: 'billRecognition', auto: true });        // 01:00 tomorrow
        apply(tx, { type: 'glExport', auto: true });               // 03:00 tomorrow
        const ran = s.log.length - before;
        if (!ran) { tx.log(`Day closed: ${today} → ${s.businessDate} · no job had work`); continue; }
        tx.log(`Day closed: ${today} → ${s.businessDate}`, [
          `17:00 on ${today}: ACH run + NACHA file for bookings dated ${today}.`,
          `01:00 on ${s.businessDate}: bill recognition. 03:00: GL export.`,
          `${ran} job(s) had work to do; see below.`,
        ]);
      }
      break;
    }

    case 'addPlanned': {
      const row = writePlanned(tx, action.row);
      tx.log(`Planned transaction #${row.id} created (${row.category} ${row.amount})`, [
        'Status PROJECTED. Nothing is posted and no money moves.',
        row.invoice_date < row.bill_date
          ? `Early invoicing: invoice date ${row.invoice_date} is before bill date ${row.bill_date}, so it will be billed on ${row.invoice_date}.`
          : `It will be billed on its bill date, ${row.bill_date}.`,
      ]);
      break;
    }

    case 'billOne':
    case 'billRecognition': {
      const rows = action.type === 'billOne' ? [tx.get('loan_planned_transactions', action.id)] : s.db.loan_planned_transactions;
      const due = rows.filter((p) => !billBlocker(s, p));
      if (!due.length && action.type === 'billRecognition' && action.auto) break;
      if (!due.length) tx.log('Bill recognition: nothing due', [`No PROJECTED row has its invoice/bill date on or before ${s.businessDate}. Move to the next day.`]);
      else tx.log(`Bill recognition: ${due.length} row(s) billed`, due.flatMap((p) => recognize(tx, p)));
      break;
    }

    case 'pay': {
      const m = METHODS[action.method];
      const why = itemsBlocker(s, action.items);
      const total = r2(action.items.reduce((a, i) => a + i.amount, 0));
      if (why) { tx.log(`${m.label}: refused`, [why], true); break; }
      if (m.kind === 'internal' && s.balances[action.method as Holding] < total) {
        tx.log(`${m.label}: refused`, [`Balance ${s.balances[action.method as Holding].toFixed(2)} is less than ${total.toFixed(2)}.`], true);
        break;
      }
      const type = m.kind === 'relief' ? action.method : action.method === 'SURPLUS' ? 'SURPLUS' : 'CASH_POSTING';
      const pay = tx.insert('payments', {
        workflow_type: type, total_amount: total, effective_date: null, status: 'PENDING',
        scheduled_transaction_id: null, obligation_effect: 'NONE', is_bank_payment: false, _method: action.method,
      });
      const lines: string[] = [];
      let ev = '';
      let holding: string | null = null;
      for (const it of action.items) {
        const p = tx.get('loan_planned_transactions', it.id);
        const ptx = postLine(tx, pay, p, r2(it.amount), {
          origin: 'REALTIME_PAYMENT_POSTING', type, source: m.kind === 'relief' ? null : action.method, itemId: null,
        });
        holding = holdingMove(tx, action.method, 'DEBIT', ptx.amount, ptx, false) ?? holding;
        ev = settlementLegs(tx, ptx, p, action.method);
        lines.push(`#${p.id} ${r2(it.amount).toFixed(2)}`);
      }
      tx.set('payments', pay, { status: 'POSTED', effective_date: s.businessDate });
      const col = m.kind === 'relief' ? AMOUNT_COL[action.method] : 'amount_paid';
      const items = [
        `Payment #${pay.id} POSTED for ${total.toFixed(2)}, one payment line per planned row: ${lines.join(', ')}.`,
        `Planned rows: ${col} goes up. Their status stays BILLED; "settled" is worked out from these amounts.`,
      ];
      if (holding) items.push(`${METHODS[action.method].label} balance debited by ${total.toFixed(2)} (now ${s.balances[action.method as Holding].toFixed(2)}).`);
      if (m.kind === 'cash') items.push(`GL: cash book + accrual book SETTLEMENT (${ev}…).`);
      else items.push(`GL: accrual book only (${ev}). No cash moved, so nothing in the cash book.`);
      tx.log(`${m.label}: ${action.items.length} row(s) settled in realtime`, items);
      break;
    }

    case 'scheduleAch': {
      const why = itemsBlocker(s, action.items)
        ?? (action.effectiveDate < s.businessDate ? `ACH date ${action.effectiveDate} is in the past` : null);
      if (why) { tx.log('Schedule ACH: refused', [why], true); break; }
      const total = r2(action.items.reduce((a, i) => a + i.amount, 0));
      const st = tx.insert('scheduled_transactions', { workflow_type: 'SCHEDULED', effective_date: action.effectiveDate, total_amount: total, status: 'SCHEDULED', processed_at: null });
      action.items.forEach((it) => tx.insert('scheduled_transaction_items', {
        scheduled_transaction_id: st.id, planned_transaction_id: it.id, action_type: 'SCHEDULED', requested_amount: r2(it.amount), status: 'SCHEDULED',
      }));
      const pay = tx.insert('payments', {
        workflow_type: 'SCHEDULED', total_amount: total, effective_date: action.effectiveDate, status: 'SCHEDULED',
        scheduled_transaction_id: st.id, obligation_effect: 'NONE', is_bank_payment: true, _method: 'ACH',
      });
      const today = action.effectiveDate === s.businessDate;
      tx.log(`ACH scheduled for ${action.effectiveDate}: ${action.items.length} row(s), ${total.toFixed(2)}`, [
        `ACH booking #${st.id} with ${action.items.length} line(s), plus payment #${pay.id} as a placeholder. All SCHEDULED.`,
        'Nothing is paid yet: no payment lines, paid amounts unchanged. The booked amount counts as "scheduled" so it cannot be paid twice.',
        today ? 'It runs in today\'s 17:00 ACH run: press Next day, or "Run ACH + NACHA" in Scheduled transactions.'
          : `It runs in the 17:00 ACH run on ${action.effectiveDate} (press Next day until that day closes). Until then you can unschedule it.`,
      ]);
      break;
    }

    case 'generateNacha': {
      const out = s.db.scheduled_transactions
        .filter((st) => st.status === 'SCHEDULED' && st.effective_date === s.businessDate)
        .flatMap((st) => settleBooking(tx, st));
      const pending = s.db.outbound_transactions.filter((o) => o.status === 'PENDING' && o.process_date <= s.businessDate);
      if (pending.length) {
        const run = tx.insert('ach_generation_runs', { business_date: s.businessDate, status: 'RUNNING' });
        for (const dir of ['CREDIT', 'DEBIT']) {
          const rows = pending.filter((o) => o.direction === dir);
          if (!rows.length) continue;
          const file = tx.insert('ach_files', { kind: 'NACHA', direction: dir, ach_generation_run_id: run.id, status: 'DRAFT' });
          const perPayment = new Map<number, number>();
          rows.forEach((o) => {
            const ptx = tx.get('payment_transactions', o.payment_transaction_id);
            perPayment.set(ptx.payment_id, r2((perPayment.get(ptx.payment_id) ?? 0) + Math.abs(ptx.amount)));
            tx.set('payment_transactions', ptx, { ach_status: 'GENERATED', ach_file_id: file.id });
            tx.set('outbound_transactions', o, { status: 'GENERATED', outbound_file_id: file.id });
          });
          perPayment.forEach((amt, payId) => tx.insert('ach_entries', {
            ach_file_id: file.id, payment_id: payId, scheduled_transaction_id: tx.get('payments', payId).scheduled_transaction_id,
            amount: amt, trace_number: String(91000010000000 + s.seq.ach_entries + 1), status: 'DRAFT',
          }));
          tx.set('ach_files', file, { status: 'BUILT' });
          out.push(`NACHA ${dir === 'DEBIT' ? 'debit (collect)' : 'credit (refund)'} file #${file.id}: ${perPayment.size} entr${perPayment.size === 1 ? 'y' : 'ies'}.`);
        }
        tx.set('ach_generation_runs', run, { status: 'COMPLETED' });
        out.push('Payment lines marked ach_status = GENERATED; bank instructions → GENERATED.');
      }
      if (!out.length && action.auto) break;
      if (!out.length) out.push(`No ACH booking dated ${s.businessDate} and no pending bank instruction.`);
      tx.log('ACH run + NACHA file', out);
      break;
    }

    case 'unschedule': {
      const pay = tx.get('payments', action.paymentId);
      const st = tx.get('scheduled_transactions', pay.scheduled_transaction_id);
      tx.set('scheduled_transactions', st, { status: 'CANCELLED' });
      s.db.scheduled_transaction_items.filter((i) => i.scheduled_transaction_id === st.id)
        .forEach((i) => tx.set('scheduled_transaction_items', i, { status: 'CANCELLED' }));
      tx.set('payments', pay, { status: 'CANCELLED' });
      tx.log(`Payment #${pay.id} unscheduled`, ['ACH booking, its lines and the placeholder payment → CANCELLED. Nothing had been posted, so nothing to reverse.']);
      break;
    }

    case 'rescind': {
      // reversal.service rescindPaymentSettlement: only from POSTED.
      const pay = tx.get('payments', action.paymentId);
      const method = (pay._method === 'ACH' ? 'CASH' : pay._method) as PayMethod;
      const pairs = reverseLines(tx, pay);
      const out = [`${pairs.length} reversal payment line(s); the planned amounts are rolled back and the GL entries reversed.`];
      if (METHODS[method].kind === 'internal') {
        pairs.forEach(({ rev }) => holdingMove(tx, method, 'CREDIT', Math.abs(rev.amount), rev, true));
        out.push(`Funded internally, so nothing is refunded: the ${METHODS[method].label.toLowerCase()} balance is restored (now ${s.balances[method as Holding].toFixed(2)}).`);
      } else if (pay.workflow_type === 'SCHEDULED') {
        const originals = s.db.outbound_transactions.filter((o) => pairs.some(({ ptx }) => ptx.id === o.payment_transaction_id));
        const pending = originals.filter((o) => o.status === 'PENDING');
        pending.forEach((o) => tx.set('outbound_transactions', o, { status: 'CANCELLED' }));
        if (originals.length && pending.length === originals.length) {
          out.push('The debit had not gone to the bank yet, so its bank instruction is just CANCELLED. No refund.');
        } else {
          pairs.forEach(({ rev }) => tx.insert('outbound_transactions', {
            payment_transaction_id: rev.id, process_type: 'ACH', direction: 'CREDIT', process_date: s.businessDate, status: 'PENDING', outbound_file_id: null,
          }));
          out.push('The debit already went out in a NACHA file, so a refund bank instruction (CREDIT, PENDING) is created. It goes out in the next NACHA run.');
        }
      }
      tx.set('payments', pay, { status: 'RESCINDED', obligation_effect: 'REOPEN' });
      if (pay.scheduled_transaction_id) {
        const st = tx.get('scheduled_transactions', pay.scheduled_transaction_id);
        tx.set('scheduled_transactions', st, { status: 'RESCINDED' });
        s.db.scheduled_transaction_items.filter((i) => i.scheduled_transaction_id === st.id).forEach((i) => tx.set('scheduled_transaction_items', i, { status: 'RESCINDED' }));
      }
      out.push('Payment → RESCINDED. Bills and invoices are untouched, so the rows are open and payable again.');
      tx.log(`Payment #${pay.id} rescinded (we reverse it)`, out);
      break;
    }

    case 'reject': {
      // reversal.service rejectPaymentSettlement: the bank returned the ACH debit.
      const pay = tx.get('payments', action.paymentId);
      const pairs = reverseLines(tx, pay);
      tx.set('payments', pay, { status: 'REJECTED', obligation_effect: 'REOPEN' });
      const out = [
        'The bank returned the ACH debit: no money arrived.',
        `${pairs.length} reversal payment line(s); paid amounts rolled back; GL cash + accrual entries reversed. No refund, because nothing was collected.`,
      ];
      if (pay.scheduled_transaction_id) {
        const st = tx.get('scheduled_transactions', pay.scheduled_transaction_id);
        tx.set('scheduled_transactions', st, { status: 'REJECTED' });
        s.db.scheduled_transaction_items.filter((i) => i.scheduled_transaction_id === st.id).forEach((i) => tx.set('scheduled_transaction_items', i, { status: 'REJECTED' }));
        out.push(`ACH booking #${st.id} and its lines → REJECTED.`);
      }
      out.push('Payment → REJECTED. Bills and invoices are untouched; the rows are payable again.');
      tx.log(`Payment #${pay.id} rejected (bank return)`, out);
      break;
    }

    case 'glExport': {
      const out: string[] = [];
      ([['gl_accrual_leg', 'ACCRUAL'], ['gl_cash_movement_leg', 'CASH']] as const).forEach(([t, book]) => {
        const legs = s.db[t].filter((l) => l.export_batch_id == null);
        if (!legs.length) return;
        const b = tx.insert('gl_export_batch', { book, business_date: s.businessDate, leg_count: legs.length, status: 'EXPORTED' });
        legs.forEach((l) => tx.set(t, l, { export_batch_id: b.id }));
        out.push(`${book} book: export #${b.id} with ${legs.length} entries; each one is stamped so it is never exported twice.`);
      });
      if (!out.length && action.auto) break;
      if (!out.length) out.push('No new GL entries to export.');
      out.push('In VeroLMS this runs daily for the previous business date and uploads the file.');
      tx.log('GL export', out);
      break;
    }
  }
}
