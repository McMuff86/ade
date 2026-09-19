import { t as translate } from "../../shared/i18n";
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IntegrationReport } from '../../shared/remote';
import { validProjectGitPath } from '../../shared/projectGit';
import { assertNoLinks } from './pathDiscipline';
import { readIntegrationFile } from './IntegrationGit';
import { integrationFail } from './IntegrationAnalysis';
import { redactForWire } from '../errors';

export interface IntegrationRecord {
  report: IntegrationReport;
  sourceId: string;
  sourceFingerprint: string;
  targetIdentity: string;
  selected: string[];
  snapshot: string | null;
  testedTree: string | null;
  testedState: string | null;
  reviewCommit: string | null;
}
const sha = (value: unknown) => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value);
const string = (value: unknown, limit = 400) => typeof value === 'string' && value.length <= limit;
const optionalSha = (value: unknown) => value === null || sha(value);
const exact = (value: object, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const safeText = (value: unknown, limit: number) => string(value, limit) && redactForWire(value as string, limit) === value;
function valid(record: IntegrationRecord): boolean {
  const view = record?.report;
  return !!view && exact(record, ['report', 'sourceId', 'sourceFingerprint', 'targetIdentity', 'selected', 'snapshot', 'testedTree', 'testedState', 'reviewCommit'])
    && exact(view, ['id', 'repositoryId', 'projectName', 'sourceName', 'sourceHead', 'targetBranch', 'targetHead', 'branch', 'workspaceId', 'phase', 'files', 'blockers', 'checks', 'checkNotice', 'tested', 'revision', 'createdAt', 'integratedCommit'])
    && id(view.id) && id(view.repositoryId) && id(record.sourceId) && sha(record.sourceFingerprint) && sha(record.targetIdentity)
    && Array.isArray(record.selected) && record.selected.length > 0 && record.selected.length <= 200 && record.selected.every(validProjectGitPath)
    && optionalSha(record.snapshot) && optionalSha(record.testedTree) && optionalSha(record.testedState) && optionalSha(record.reviewCommit)
    && ['projectName', 'sourceName', 'targetBranch'].every((key) => safeText(view[key as keyof IntegrationReport], 400))
    && view.branch === `ade/integration-${view.id}` && sha(view.sourceHead) && sha(view.targetHead) && sha(view.revision)
    && (view.workspaceId === null || id(view.workspaceId)) && ['preparing', 'review', 'testing', 'ready', 'integrated', 'interrupted'].includes(view.phase)
    && Array.isArray(view.files) && view.files.length <= 200 && view.files.every((file) => exact(file, ['path', 'conflict']) && validProjectGitPath(file.path) && safeText(file.path, 400) && typeof file.conflict === 'boolean')
    && Array.isArray(view.blockers) && view.blockers.length <= 30 && view.blockers.every((text) => safeText(text, 1000))
    && Array.isArray(view.checks) && view.checks.length <= 20 && view.checks.every((check) => exact(check, ['label', 'status', 'output', 'exitCode']) && safeText(check.label, 400) && safeText(check.output, 8192)
      && ['pending', 'running', 'passed', 'failed'].includes(check.status) && (check.exitCode === null || Number.isInteger(check.exitCode)))
    && safeText(view.checkNotice, 2000) && typeof view.tested === 'boolean' && Number.isSafeInteger(view.createdAt) && optionalSha(view.integratedCommit);
}

/** Bounded durable review metadata. Source bytes live in a retained Git snapshot. */
export class IntegrationRecords {
  private records: IntegrationRecord[] = [];
  private available = true;
  constructor(private readonly file: string) {
    try {
      assertNoLinks(file); mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const bytes = readIntegrationFile(file, 8 * 1024 * 1024);
      if (bytes) {
        const data = JSON.parse(bytes.toString('utf8')) as { version: number; records: IntegrationRecord[] };
        if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > 50 || !data.records.every(valid)
          || new Set(data.records.map((record) => record.report.id)).size !== data.records.length) integrationFail(translate("Invalid integration storage."));
        this.records = data.records;
        let changed = false;
        for (const record of this.records) if (record.report.phase === 'preparing' || record.report.phase === 'testing') {
          changed = true; record.report.phase = 'interrupted'; record.report.tested = false; record.testedTree = null; record.testedState = null;
          record.report.blockers = [translate("Preparation or testing interrupted by restart. Check working copy and restart tests.")];
          for (const check of record.report.checks) if (check.status === 'running' || check.status === 'pending') { check.status = 'failed'; check.output = translate("Interrupted by restart."); }
        }
        if (changed) this.write(this.records);
      }
    } catch { this.available = false; console.warn('[ade] integration review store unavailable; integration disabled'); }
  }
  list(): IntegrationRecord[] { this.assertAvailable(); return structuredClone(this.records); }
  get(id: string): IntegrationRecord {
    this.assertAvailable(); const record = this.records.find((item) => item.report.id === id);
    if (!record) integrationFail(translate("There is no integration report."));
    return structuredClone(record!);
  }
  save(record: IntegrationRecord): void {
    this.assertAvailable(); if (!valid(record)) integrationFail(translate("The integration report exceeds its limits."));
    const next = this.records.filter((item) => item.report.id !== record.report.id).concat(structuredClone(record));
    if (next.length > 50) integrationFail(translate("Maximum of 50 stored integrations. Manage storage on the PC."));
    this.write(next); this.records = next;
  }
  private assertAvailable(): void { if (!this.available) integrationFail(translate("Integration storage is not available. Check original file on PC.")); }
  private write(records: IntegrationRecord[]): void {
    const text = JSON.stringify({ version: 1, records });
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) integrationFail(translate("Integration storage is full."));
    assertNoLinks(this.file); readIntegrationFile(this.file, 8 * 1024 * 1024);
    const temporary = `${this.file}.${randomUUID()}.tmp`; const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
    try { assertNoLinks(this.file); readIntegrationFile(this.file, 8 * 1024 * 1024); renameSync(temporary, this.file); }
    finally { try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  }
}
