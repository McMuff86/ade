import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/** Direct task composer of manual runs: to one participant, one team, or all teams. */

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { dispatchAgent, dispatchAll, dispatchTeam } from './graphActions';

export type ComposerTarget =
  | { kind: 'all'; workerCount: number }
  | { kind: 'team'; id: string; name: string; workerCount: number }
  | { kind: 'participant'; id: string; name: string };

/** Dispatches the composed task and returns the confirmation text for the toast. */
export async function sendComposerTask(
  target: ComposerTarget,
  text: string,
  options: { toWorkers: boolean },
): Promise<string> {
  if (target.kind === 'all') {
    const result = await dispatchAll(text, options);
    return result.failed
      ? translate("{{value1}} started, {{value2}} failed", { value1: result.started, value2: result.failed })
      : translate("{{value1}} task sessions started", { value1: result.started });
  }
  if (target.kind === 'team') {
    const result = await dispatchTeam(target.id, text, options);
    return result.failed
      ? translate("{{value1}} started, {{value2}} failed", { value1: result.started, value2: result.failed })
      : translate('Task distributed to {{name}}', { name: target.name });
  }
  const result = await dispatchAgent(target.id, text);
  return result.failed ? translate("Task for {{value1}} failed", { value1: target.name }) : translate("Task sent to {{value1}}", { value1: target.name });
}

export function Composer(props: {
  target: ComposerTarget;
  onCancel: () => void;
  onSend: (text: string, options: { toWorkers: boolean }) => void;
}): JSX.Element {
  useLocale();
  const [text, setText] = useState('');
  const [toWorkers, setToWorkers] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const target = props.target;
  const label = target.kind === 'all'
    ? translate("all teams")
    : target.kind === 'team' ? `team · ${target.name}` : target.name;
  const canDistribute = target.kind !== 'participant';
  const workerCount = target.kind === 'participant' ? 0 : target.workerCount;
  const distribute = canDistribute && toWorkers && workerCount > 0;
  const submit = (): void => {
    if (text.trim()) props.onSend(text, { toWorkers: distribute });
  };
  return (
    <div className="gcomposer-back" onPointerDown={props.onCancel}>
      <div className="gcomposer" onPointerDown={(event) => event.stopPropagation()}>
        <h3>{translate("Task for")}{" "}<b>{label}</b></h3>
        <textarea
          ref={inputRef}
          value={text}
          maxLength={8_000}
          placeholder={translate("Describe task")}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
            if (event.key === 'Escape') props.onCancel();
          }}
        />
        {canDistribute && (
          <label className="gcomposer-dist">
            <input
              type="checkbox"
              checked={distribute}
              disabled={workerCount === 0}
              onChange={(event) => setToWorkers(event.target.checked)}
            />
            <span>{translate("Also to")}{" "}{workerCount}{" "}{translate("Distribute workers")}</span>
          </label>
        )}
        <div className="gcomposer-meta">{text.length} / 8000</div>
        <div className="gcomposer-foot">
          <button className="gact" onClick={props.onCancel}>{translate("Cancel")}</button>
          <button className="gact primary" disabled={!text.trim()} onClick={submit}>{translate("Send")}</button>
        </div>
      </div>
    </div>
  );
}
