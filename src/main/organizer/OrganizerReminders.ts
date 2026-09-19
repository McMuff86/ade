import { dueOrganizerReminders, type OrganizerIndex } from '../../shared/organizer';

/** An unacknowledged reminder may appear again after restart. No task is launched. */
export class OrganizerReminders {
  private notified = new Map<string, number>();
  constructor(private readonly read: () => OrganizerIndex, private readonly notify: (count: number) => void, private readonly now = Date.now) {}
  check(): void {
    const index = this.read(); const due = dueOrganizerReminders(index, this.now());
    const ids = new Set(index.entries.filter(item => !item.deleted).map(item => item.id));
    for (const id of this.notified.keys()) if (!ids.has(id)) this.notified.delete(id);
    const fresh = due.filter(item => this.notified.get(item.id) !== item.reminderAt);
    if (!fresh.length) return;
    this.notify(fresh.length);
    for (const item of fresh) this.notified.set(item.id, item.reminderAt!);
  }
}
