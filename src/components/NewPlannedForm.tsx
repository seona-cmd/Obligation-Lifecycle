import { useState } from 'react';
import { addDays, type Category, type NewPlanned } from '../engine';

interface Props {
  businessDate: string;
  onSubmit: (row: NewPlanned) => void;
}

export default function NewPlannedForm({ businessDate, onSubmit }: Props) {
  const [category, setCategory] = useState<Category>('INTEREST');
  const [amount, setAmount] = useState(125);
  const [billIn, setBillIn] = useState(0);
  const [dueAfter, setDueAfter] = useState(10);
  const [early, setEarly] = useState(false);
  const [lead, setLead] = useState(2);
  const billDate = addDays(businessDate, billIn);

  return (
    <div className="form">
      <label>Category
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          <option>INTEREST</option><option>PRINCIPAL</option><option>FEE</option>
        </select>
      </label>
      <label>Amount
        <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)} />
      </label>
      <label>Bill date: days from today
        <input type="number" min={0} value={billIn} onChange={(e) => setBillIn(Number(e.target.value))} />
      </label>
      <label>Due date: days after bill date
        <input type="number" min={0} value={dueAfter} onChange={(e) => setDueAfter(Number(e.target.value))} />
      </label>
      <label className="check wide">
        <input type="checkbox" checked={early} onChange={(e) => setEarly(e.target.checked)} />
        Early invoicing, lead days
        <input type="number" className="tiny" min={0} value={lead} onChange={(e) => setLead(Number(e.target.value))} disabled={!early} />
      </label>
      <p className="hint wide">
        Bill date <code>{billDate}</code>. The invoice date is set when the row is written: the bill date minus the
        lead days, never earlier than tomorrow.
      </p>
      <div className="wide right">
        <button className="primary" onClick={() => onSubmit({
          category, amount, billDate, dueDate: addDays(billDate, dueAfter), earlyInvoicing: early, leadDays: lead,
        })}>Create planned transaction</button>
      </div>
    </div>
  );
}
