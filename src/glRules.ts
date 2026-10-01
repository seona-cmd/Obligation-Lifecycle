/**
 * Snapshot of gl_posting_rule + gl_account from the local lms_db (all migrations applied),
 * taken 2026-10-01. Each event posts leg 1 = DEBIT, leg 2 = CREDIT. The export maps these
 * internal codes to each partner's own chart through partner_gl_mapping.
 */
export const GL_ACCOUNTS: Record<string, { name: string; type: string }> = {
  '1000': { name: 'Cash / Bank', type: 'ASSET' },
  '1500': { name: 'Recognized Loss / Write-off', type: 'EXPENSE' },
  '1510': { name: 'Interest Written-off / Loss', type: 'EXPENSE' },
  '1520': { name: 'Principal Written-off / Loss', type: 'EXPENSE' },
  '2500': { name: 'Loans / Floorplan Receivable', type: 'ASSET' },
  '2520': { name: 'Principal Billed / Current-Due Receivable', type: 'ASSET' },
  '2600': { name: 'Surplus Holding (Customer Funds)', type: 'LIABILITY' },
  '2700': { name: 'Dealer Open Account (Credits Payable)', type: 'LIABILITY' },
  '2820': { name: 'CMA Interest Holding Liability', type: 'LIABILITY' },
  '4200': { name: 'Interest Clearing', type: 'CLEARING' },
  '4301': { name: 'Fee Clearing', type: 'CLEARING' },
  '8000': { name: 'Fee Income (Legacy Collections)', type: 'INCOME' },
  '8100': { name: 'Fee Waived Contra Income', type: 'CONTRA' },
  '8110': { name: 'Interest Waived Contra Income', type: 'CONTRA' },
  '8120': { name: 'Principal Waived / Forgiveness Loss', type: 'CONTRA' },
  '8200': { name: 'Interest Income', type: 'INCOME' },
};

type Cat = 'INTEREST' | 'FEE' | 'PRINCIPAL';
const same = (dr: string, cr: string): Record<Cat, [string, string]> => ({ INTEREST: [dr, cr], FEE: [dr, cr], PRINCIPAL: [dr, cr] });

/** event_type → category → [debit account, credit account] */
export const GL_RULES: Record<string, Record<Cat, [string, string]>> = {
  // Bill recognition
  INTEREST_BILL: same('4200', '8200'),
  FEE_BILL: same('4301', '8000'),
  PRINCIPAL_BILL: same('2520', '2500'),
  // Cash settlement (cash posting and ACH)
  INTEREST_SETTLE: same('1000', '4200'),
  FEE_SETTLE: same('1000', '4301'),
  PRINCIPAL_SETTLE: same('1000', '2520'),
  // Internal settlement: a holding liability pays instead of cash
  DEALER_CREDIT_APPLY: { INTEREST: ['2700', '4200'], FEE: ['2700', '4301'], PRINCIPAL: ['2700', '2520'] },
  SURPLUS_APPLY: { INTEREST: ['2600', '4200'], FEE: ['2600', '4301'], PRINCIPAL: ['2600', '2520'] },
  CMA_HOLDING_APPLY: { INTEREST: ['2820', '4200'], FEE: ['2820', '4301'], PRINCIPAL: ['2820', '2520'] },
  // Relief: nobody pays
  WAIVE: { INTEREST: ['8110', '4200'], FEE: ['8100', '4301'], PRINCIPAL: ['8120', '2500'] },
  WRITE_OFF: { INTEREST: ['1510', '4200'], FEE: ['1500', '4301'], PRINCIPAL: ['1520', '2500'] },
};

export function accountFor(eventType: string, category: string, drCr: 'DEBIT' | 'CREDIT'): string | null {
  const pair = GL_RULES[eventType]?.[category as Cat];
  if (!pair) return null;
  return drCr === 'DEBIT' ? pair[0] : pair[1];
}
