import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/**
 * Desktop settings layout: a topic navigation on the left and one scroll area
 * on the right that holds every topic. The navigation jumps to a topic, moves
 * focus to its heading and marks the topic in view (aria-current), so every
 * setting stays reachable and findable with Ctrl+F. The tablet keeps its
 * compact Allgemein/Stimme tabs (SettingsTabs).
 */
import { useCallback, useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react';
import './settings-topics.css';

export interface SettingsTopic {
  id: string;
  label: string;
  content: ReactNode;
}

export function SettingsTopics(props: { topics: SettingsTopic[]; lead?: ReactNode; testId?: string }): JSX.Element {
  useLocale();
  const { topics } = props;
  const prefix = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [current, setCurrent] = useState<string | undefined>(topics[0]?.id);
  const topicId = (id: string): string => `${prefix}-topic-${id}`;

  /** The topic whose heading last passed the top edge; the last one once scrolled to the end. */
  const sync = useCallback(() => {
    const container = scroller.current;
    if (!container) return;
    let next: string | undefined = topics[0]?.id;
    for (const topic of topics) {
      const node = document.getElementById(topicId(topic.id));
      if (node && node.offsetTop <= container.scrollTop + 24) next = topic.id;
    }
    const scrolled = container.scrollHeight > container.clientHeight + 1 && container.scrollTop > 0;
    if (scrolled && container.scrollTop + container.clientHeight >= container.scrollHeight - 2) next = topics.at(-1)?.id;
    setCurrent(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics]);

  // Topics are passed inline on every render; only their count changes the layout.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { sync(); }, [topics.length]);

  const go = (id: string): void => {
    const node = document.getElementById(topicId(id));
    if (!node) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    node.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    node.querySelector<HTMLElement>('.st-topic-title')?.focus({ preventScroll: true });
    setCurrent(id);
  };

  const onNavKey = (index: number) => (event: React.KeyboardEvent): void => {
    const next = event.key === 'ArrowDown' ? (index + 1) % topics.length
      : event.key === 'ArrowUp' ? (index - 1 + topics.length) % topics.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? topics.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    buttons.current[next]?.focus();
  };

  return (
    <div className="st-layout">
      <nav className="st-nav" aria-label={translate("Settings sections")}>
        {topics.map((topic, index) => (
          <button
            key={topic.id}
            ref={(node) => { buttons.current[index] = node; }}
            type="button"
            className="st-nav-item"
            aria-current={current === topic.id ? 'true' : undefined}
            aria-controls={topicId(topic.id)}
            onClick={() => go(topic.id)}
            onKeyDown={onNavKey(index)}
          >
            {topic.label}
          </button>
        ))}
      </nav>
      <div className="st-scroll" ref={scroller} onScroll={sync} data-testid={props.testId}>
        {props.lead}
        {topics.map((topic) => (
          <section key={topic.id} id={topicId(topic.id)} className="st-topic" aria-labelledby={`${topicId(topic.id)}-title`}>
            <h3 id={`${topicId(topic.id)}-title`} className="st-topic-title" tabIndex={-1}>{topic.label}</h3>
            {topic.content}
          </section>
        ))}
      </div>
    </div>
  );
}
