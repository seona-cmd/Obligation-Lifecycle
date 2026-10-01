export type Family = 'plan' | 'bill' | 'pay' | 'hold' | 'sched' | 'ach' | 'gl';

export interface TableDef {
  /** Real VeroLMS table (shown as a tooltip). */
  name: string;
  /** Plain name shown on the page. */
  label: string;
  family: Family;
  about: string;
  columns: string[];
}

export const TABLES: TableDef[] = [
  { name: 'loan_planned_transactions', label: 'Planned transactions', family: 'plan', about: 'What is owed and when.',
    columns: ['id', 'category', 'amount', 'invoice_date', 'bill_date', 'due_date', 'status', 'billed_total_amount', 'amount_paid', 'amount_waived', 'amount_written_off', 'reason_code'] },
  { name: 'bill_transactions', label: 'Bills', family: 'bill', about: 'One per obligation, written when it is billed.',
    columns: ['id', 'planned_transaction_id', 'amount', 'outstanding', 'bill_date', 'invoice_date', 'effective_date', 'process_date', 'status'] },
  { name: 'invoice', label: 'Invoices', family: 'bill', about: 'The document sent to the dealer for that obligation.',
    columns: ['id', 'invoice_number', 'planned_transaction_id', 'category', 'invoice_date', 'invoice_amount', 'due_date', 'status'] },
  { name: 'payments', label: 'Payments', family: 'pay', about: 'The header of one payment.',
    columns: ['id', 'workflow_type', 'total_amount', 'effective_date', 'status', 'scheduled_transaction_id', 'obligation_effect', 'is_bank_payment'] },
  { name: 'payment_transactions', label: 'Payment lines', family: 'pay', about: 'One line per obligation the payment paid.',
    columns: ['id', 'payment_id', 'planned_transaction_id', 'bill_transaction_id', 'item_id', 'payment_type', 'settlement_source', 'amount', 'status', 'is_reversal', 'reverses_payment_transaction_id', 'ach_status', 'ach_file_id'] },
  { name: 'dealer_credit_movement', label: 'Open account movements', family: 'hold', about: 'Dealer open account balance going down (or back up).',
    columns: ['id', 'direction', 'amount', 'balance_after', 'planned_transaction_id', 'payment_transaction_id', 'is_reversal'] },
  { name: 'surplus_movement', label: 'Surplus movements', family: 'hold', about: 'Surplus account balance going down (or back up).',
    columns: ['id', 'direction', 'amount', 'balance_after', 'planned_transaction_id', 'payment_id', 'is_reversal'] },
  { name: 'cma_movement', label: 'CMA movements', family: 'hold', about: 'CMA holding balance going down (or back up).',
    columns: ['id', 'direction', 'amount', 'balance_after', 'planned_transaction_id', 'payment_transaction_id', 'is_reversal'] },
  { name: 'scheduled_transactions', label: 'ACH bookings', family: 'sched', about: 'An ACH payment booked for a date.',
    columns: ['id', 'workflow_type', 'effective_date', 'total_amount', 'status', 'processed_at'] },
  { name: 'scheduled_transaction_items', label: 'ACH booking lines', family: 'sched', about: 'Which obligations the booking pays, and how much.',
    columns: ['id', 'scheduled_transaction_id', 'planned_transaction_id', 'action_type', 'requested_amount', 'status'] },
  { name: 'outbound_transactions', label: 'Bank instructions', family: 'ach', about: 'A debit (or refund) waiting to go into a bank file.',
    columns: ['id', 'payment_transaction_id', 'process_type', 'direction', 'process_date', 'status', 'outbound_file_id'] },
  { name: 'ach_generation_runs', label: 'NACHA runs', family: 'ach', about: 'One NACHA generation run.',
    columns: ['id', 'business_date', 'status'] },
  { name: 'ach_files', label: 'NACHA files', family: 'ach', about: 'The file sent to the bank.',
    columns: ['id', 'kind', 'direction', 'ach_generation_run_id', 'status'] },
  { name: 'ach_entries', label: 'NACHA entries', family: 'ach', about: 'One line per payment inside the file.',
    columns: ['id', 'ach_file_id', 'payment_id', 'scheduled_transaction_id', 'amount', 'trace_number', 'status'] },
  { name: 'gl_accrual_leg', label: 'GL accrual book', family: 'gl', about: 'RECOGNITION when billed, SETTLEMENT when paid.',
    columns: ['id', 'phase', 'event_type', 'dr_cr', 'gl_account_code', 'amount', 'bill_transaction_id', 'payment_transaction_id', 'is_reversal', 'export_batch_id'] },
  { name: 'gl_cash_movement_leg', label: 'GL cash book', family: 'gl', about: 'Only when real cash moves.',
    columns: ['id', 'event_type', 'dr_cr', 'gl_account_code', 'amount', 'payment_transaction_id', 'is_reversal', 'export_batch_id'] },
  { name: 'gl_export_batch', label: 'GL exports', family: 'gl', about: 'One exported GL file per book.',
    columns: ['id', 'book', 'business_date', 'leg_count', 'status'] },
];

export const LABEL: Record<string, string> = Object.fromEntries(TABLES.map((t) => [t.name, t.label]));

export const FAMILY_LABEL: Record<Family, string> = {
  plan: 'Planned', bill: 'Billing', pay: 'Payment', hold: 'Holding accounts', sched: 'ACH booking', ach: 'Bank file (NACHA)', gl: 'General ledger',
};
