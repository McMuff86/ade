import { useId, useRef, useState, type ReactNode } from 'react';
import './speech-preference.css';

export function SettingsTabs({ children, voice }: { children: ReactNode; voice: ReactNode }) {
  const [tab, setTab] = useState(0); const id = useId(); const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return <div className="settings-tabs">
    <div role="tablist" aria-label="Einstellungsbereiche" className="settings-tab-list">
      {['Allgemein', 'Stimme'].map((name, index) => <button key={name} ref={node => { buttons.current[index] = node; }} type="button" role="tab"
        id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1}
        onClick={() => setTab(index)} onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 1 - index : undefined;
          if (next !== undefined) { event.preventDefault(); setTab(next); buttons.current[next]?.focus(); }
        }}>{name}</button>)}
    </div>
    {[children, voice].map((content, index) => <div key={index} id={`${id}-panel-${index}`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`} hidden={tab !== index}>
      {tab === index ? content : null}
    </div>)}
  </div>;
}
