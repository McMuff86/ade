import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Agent, RunMessage, StructuredTaskResult } from '../../shared/types';
import type { OrchestrationService } from './OrchestrationService';
import type { ManagedTaskFiles } from './runtimeAdapters';

/**
 * Inspectable, runtime-neutral mailbox fallback. Main persists the message
 * journal and mirrors each delivery into the recipient agent's memoryDir.
 */
export class MailboxService {
  constructor(private readonly orchestration: OrchestrationService) {}

  taskFiles(agent: Agent, runId: string, taskId: string): ManagedTaskFiles {
    const safeRunId = safeSegment(runId);
    const safeTaskId = safeSegment(taskId);
    const mailboxDir = join(agent.memoryDir, 'mailbox', safeRunId);
    const taskDir = join(agent.memoryDir, 'orchestration', safeRunId, safeTaskId);
    mkdirSync(mailboxDir, { recursive: true });
    mkdirSync(taskDir, { recursive: true });
    return {
      taskDir,
      resultPath: join(taskDir, 'RESULT.json'),
      schemaPath: join(taskDir, 'RESULT.schema.json'),
      inboxPath: join(mailboxDir, 'INBOX.jsonl'),
      outboxPath: join(mailboxDir, 'OUTBOX.jsonl'),
    };
  }

  deliver(
    recipient: Agent,
    input: Omit<RunMessage, 'id' | 'createdAt'>,
  ): RunMessage {
    const message = this.orchestration.sendMessage(input);
    const path = join(recipient.memoryDir, 'mailbox', safeSegment(input.runId), 'INBOX.jsonl');
    appendJsonLine(path, message);
    return message;
  }

  recordResult(
    agent: Agent,
    runId: string,
    taskId: string,
    participantId: string,
    result: StructuredTaskResult,
  ): void {
    const path = join(agent.memoryDir, 'mailbox', safeSegment(runId), 'OUTBOX.jsonl');
    appendJsonLine(path, {
      version: 1,
      kind: 'result',
      runId,
      taskId,
      participantId,
      createdAt: Date.now(),
      result,
    });
  }
}

function appendJsonLine(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error('ade: unsafe orchestration path segment');
  return value;
}
