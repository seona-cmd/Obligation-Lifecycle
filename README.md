# VeroLMS: From Planned Transaction to Payment

An interactive explainer for product colleagues. A flow diagram walks through planned → billed → paid. Each step's button writes rows into simulated VeroLMS tables, and the page highlights exactly what changed.

Everything runs in the browser. There is no backend or database.

## Run locally

```bash
npm install
npm run dev
```

## Deploy to Vercel

Import this folder in Vercel. It detects Vite automatically: the build command is `npm run build` and the output directory is `dist`. You can also deploy from the CLI with `npx vercel`.

## What it shows

- **Next day** closes today with the 17:00 ACH run + NACHA file (bookings dated today), then opens tomorrow with 01:00 bill recognition and 03:00 GL export.
- **Planned transactions** are shown as a table with billed, paid, waived, written-off, scheduled and remaining amounts. "Run bill recognition" bills every row that is due. Each billed row has an Invoice pop-up.
- **Paying.** Tick one or more billed rows and edit the amounts; the result is one payment with one payment line per row.
  - Realtime: cash posting, dealer open account, surplus account, CMA account.
  - Relief: waive, write off.
  - ACH: book for today or a future date.
- **Payments** has its own table, with Unschedule (booked ACH), Rescind (we reverse a posted payment: refund an ACH debit that went out, or restore the internal balance) and Reject (bank return of an ACH debit).
- **GL account design** is a matrix of which account each step debits and credits, with a GL export button. The codes are a snapshot of `gl_posting_rule` / `gl_account` from the local `lms_db` (2026-10-01), stored in `src/glRules.ts`.
- **Database tables** are shown with plain names; hover a table to see its real name.

## Simplified

- Interest pricing uses `amount`.
- Holding accounts start with fixed demo balances.
- Partner-held surplus (account 2601), bank cut-offs, rescind dispositions (credit or surplus instead of refund) and the `gl_export_file` upload step are not modelled.
- Waive and write off are limited to billed rows here; VeroLMS also allows them on unbilled rows.
