import type { CoordinatorActionDetail, CoordinatorActionSummary, CoordinatorActionWork } from '../../shared/coordinatorActions';
import { redactForWire } from '../errors';

export function coordinatorActionForWire(a: CoordinatorActionSummary): CoordinatorActionSummary {
  return { ...a, projectName: redactForWire(a.projectName, 200), agentName: a.agentName === null ? null : redactForWire(a.agentName, 200), error: redactForWire(a.error, 2000) };
}
export function coordinatorActionDetailForWire(d: CoordinatorActionDetail): CoordinatorActionDetail {
  return { action: coordinatorActionForWire(d.action), text: d.text === null ? null : redactForWire(d.text, 4000), nextStep: d.nextStep === null ? null : redactForWire(d.nextStep, 4000) };
}
export function coordinatorActionWorkForWire(work: CoordinatorActionWork): CoordinatorActionWork {
  const task = work.task;
  const clean = (s: string, max = 64 * 1024) => redactForWire(s, max);
  return { task: task ? { id: task.id, status: task.status, error: task.error ? clean(task.error, 2000) : undefined,
    output: task.output ? { ...task.output, text: clean(task.output.text) } : undefined,
    result: task.result ? { ...task.result, summary: clean(task.result.summary), filesChanged: task.result.filesChanged.map(s => clean(s, 400)),
      tests: task.result.tests.map(t => ({ ...t, command: clean(t.command, 2000), output: clean(t.output) })), risks: task.result.risks.map(s => clean(s, 4000)), adapterId: clean(task.result.adapterId, 100) } : null } : null,
    questions: { runId: work.questions.runId, tasks: work.questions.tasks.map(t => ({ ...t, title: clean(t.title, 160), agentName: clean(t.agentName, 200),
      questions: t.questions.map(q => ({ ...q, questions: q.questions.map(i => ({ ...i, header: clean(i.header, 120), question: clean(i.question, 8000),
        options: i.options?.map(o => ({ label: clean(o.label, 300), description: clean(o.description, 2000) })) ?? null })) })) })) } };
}
