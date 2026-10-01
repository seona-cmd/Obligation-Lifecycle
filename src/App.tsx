import { useMemo, useReducer, useState } from 'react';
import { initialState, reduce } from './engine';
import FlowDiagram from './components/FlowDiagram';
import PlannedTable from './components/PlannedTable';
import PaymentsPanel from './components/PaymentsPanel';
import ScheduledPanel from './components/ScheduledPanel';
import ActivityLog from './components/ActivityLog';
import TablesPanel from './components/TablesPanel';
import Modal from './components/Modal';
import NewPlannedForm from './components/NewPlannedForm';
import GlDesign from './components/GlDesign';

export default function App() {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [showNew, setShowNew] = useState(false);
  const [logOpen, setLogOpen] = useState(true);
  const touched = useMemo(
    () => new Set([...state.touchedRows, ...state.touchedCells].map((k) => k.split(':')[0])),
    [state.touchedRows, state.touchedCells],
  );

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <h1>From planned transaction to payment</h1>
          <p>How VeroLMS bills an obligation and records its payment, one table at a time.</p>
        </div>
        <div className="controls">
          <div className="date">
            <span className="muted small">Business date</span>
            <strong>{state.businessDate}</strong>
            <button className="primary" onClick={() => dispatch({ type: 'advance', days: 1 })}
              title="Closes today (17:00 ACH run + NACHA), then opens tomorrow (01:00 bill recognition, 03:00 GL export)">
              Next day ▸ <small>runs daily jobs</small>
            </button>
          </div>
          <button className="ghost" onClick={() => dispatch({ type: 'reset' })}>Reset</button>
        </div>
      </header>

      <div className={`shell ${logOpen ? '' : 'log-closed'}`}>
        <ActivityLog log={state.log} open={logOpen} onToggle={() => setLogOpen(!logOpen)} />
        <main>
          <FlowDiagram state={state} touched={touched} />
          <PlannedTable state={state} dispatch={dispatch} onNewPlanned={() => setShowNew(true)} />
          <ScheduledPanel state={state} dispatch={dispatch} />
          <PaymentsPanel state={state} dispatch={dispatch} />
          <GlDesign state={state} dispatch={dispatch} />
          <TablesPanel state={state} />
        </main>
      </div>

      {showNew && (
        <Modal title="New planned transaction" onClose={() => setShowNew(false)}>
          <NewPlannedForm businessDate={state.businessDate} onSubmit={(row) => { dispatch({ type: 'addPlanned', row }); setShowNew(false); }} />
        </Modal>
      )}
    </>
  );
}
