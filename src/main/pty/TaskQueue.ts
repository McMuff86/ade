import type { TaskQueueStatus } from '../../shared/types';

export interface TaskQueueKey {
  agentId: string;
  dispatchId?: string;
}

export class TaskQueueCancelledError extends Error {
  constructor() {
    super('ade: queued task was cancelled');
    this.name = 'TaskQueueCancelledError';
  }
}

export interface TaskLease {
  release: () => void;
}

interface PendingAcquire {
  key: TaskQueueKey;
  resolve: (lease: TaskLease) => void;
  reject: (error: Error) => void;
}

/** FIFO semaphore whose lease remains active until the owning task process exits. */
export class TaskSlotQueue {
  private active = 0;
  private readonly pending: PendingAcquire[] = [];

  constructor(
    private readonly maxActive: number,
    private readonly onChange: (status: TaskQueueStatus) => void = () => undefined,
  ) {
    if (!Number.isInteger(maxActive) || maxActive < 1) {
      throw new Error('ade: task queue maxActive must be a positive integer');
    }
  }

  status(): TaskQueueStatus {
    return { active: this.active, queued: this.pending.length, maxActive: this.maxActive };
  }

  pendingKeys(): TaskQueueKey[] {
    return this.pending.map((item) => ({ ...item.key }));
  }

  acquire(key: TaskQueueKey): Promise<TaskLease> {
    if (this.active < this.maxActive) {
      return Promise.resolve(this.createLease());
    }
    return new Promise<TaskLease>((resolve, reject) => {
      this.pending.push({ key, resolve, reject });
      this.emit();
    });
  }

  cancelPending(matches: (key: TaskQueueKey) => boolean): TaskQueueKey[] {
    const cancelled: TaskQueueKey[] = [];
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      const item = this.pending[i];
      if (!item || !matches(item.key)) continue;
      this.pending.splice(i, 1);
      cancelled.push({ ...item.key });
      item.reject(new TaskQueueCancelledError());
    }
    if (cancelled.length > 0) this.emit();
    return cancelled;
  }

  private createLease(): TaskLease {
    this.active += 1;
    this.emit();
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.active -= 1;
        this.drain();
        this.emit();
      },
    };
  }

  private drain(): void {
    while (this.active < this.maxActive && this.pending.length > 0) {
      const next = this.pending.shift();
      if (next) next.resolve(this.createLease());
    }
  }

  private emit(): void {
    this.onChange(this.status());
  }
}
