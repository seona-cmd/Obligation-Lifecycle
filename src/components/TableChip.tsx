import { LABEL } from '../schema';

interface Props {
  table: string;
  count: number;
  touched: boolean;
  note?: string;
}

/** A table with its row count. Pulses when the last action wrote to it; click jumps to the table. */
export default function TableChip({ table, count, touched, note }: Props) {
  return (
    <a href={`#t-${table}`} title={table} className={`chip ${touched ? 'touched' : ''} ${count ? '' : 'zero'}`}>
      {LABEL[table] ?? table}
      {note && <span className="chip-note">{note}</span>}
      <span className="chip-count">{count}</span>
    </a>
  );
}
