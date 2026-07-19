/**
 * Shared fake GitHub CLI fixture for Electron/Playwright and visual tests.
 * Extracted from test-electron-workflow.ts; behavior is identical.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';

export function writeFakeGithubCli(root: string, remote: string): { bin: string; statePath: string } {
  const bin = join(root, 'fake-gh-bin');
  const statePath = join(root, 'fake-gh-state.json');
  mkdirSync(bin, { recursive: true });
  const scriptPath = join(bin, 'gh.cjs');
  const source = `
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const args = process.argv.slice(2);
const statePath = process.env.ADE_E2E_FAKE_GH_STATE;
const remote = process.env.ADE_E2E_MANAGED_REMOTE;
const repo = 'ade-e2e/managed';
const read = () => {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return null; }
};
const write = (value) => fs.writeFileSync(statePath, JSON.stringify(value) + '\\n', 'utf8');
const field = (name) => args[args.indexOf(name) + 1];
if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write('authenticated fixture\\n');
} else if (args[0] === 'repo' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({ nameWithOwner: repo }) + '\\n');
} else if (args[0] === 'pr' && args[1] === 'list') {
  if (args.includes('--limit')) {
    const rows = [{
      number: 42,
      title: 'Improve repository inspector fixture',
      url: 'https://github.com/' + repo + '/pull/42',
      author: { login: 'e2e-reviewer' },
      isDraft: false,
      updatedAt: '2026-07-19T12:00:00Z',
      headRefName: 'feature/inspector',
      baseRefName: 'main',
      reviewDecision: 'REVIEW_REQUIRED',
      changedFiles: 3,
      additions: 21,
      deletions: 4,
      statusCheckRollup: [
        { __typename: 'CheckRun', name: 'E2E Build', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { __typename: 'CheckRun', name: 'E2E Tests', status: 'COMPLETED', conclusion: 'FAILURE' },
        { __typename: 'StatusContext', context: 'E2E Lint', state: 'PENDING' },
      ],
    }];
    const state = read();
    if (state) {
      rows.push({
        number: state.number,
        title: 'ADE: Managed E2E Run',
        url: state.url,
        author: { login: 'ade-bot' },
        isDraft: state.isDraft,
        updatedAt: '2026-07-19T13:00:00Z',
        headRefName: state.headRefName,
        baseRefName: state.baseRefName,
        reviewDecision: 'REVIEW_REQUIRED',
        changedFiles: 2,
        additions: 2,
        deletions: 0,
        statusCheckRollup: state.statusCheckRollup,
      });
    }
    process.stdout.write(JSON.stringify(rows) + '\\n');
  } else {
    const state = read();
    process.stdout.write(JSON.stringify(state ? [state] : []) + '\\n');
  }
} else if (args[0] === 'pr' && args[1] === 'view' && args[2] === '42') {
  process.stdout.write(JSON.stringify({
    number: 42,
    url: 'https://github.com/' + repo + '/pull/42',
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'E2E Build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'E2E Tests', status: 'COMPLETED', conclusion: 'FAILURE' },
      { __typename: 'StatusContext', context: 'E2E Lint', state: 'PENDING' },
    ],
  }) + '\\n');
} else if (args[0] === 'pr' && args[1] === 'create') {
  const head = field('--head');
  const base = field('--base');
  if (!args.includes('--draft') || !head || !base) process.exit(7);
  const headSha = execFileSync('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/' + head], { encoding: 'utf8' }).trim();
  const state = {
    number: 71,
    url: 'https://github.com/' + repo + '/pull/71',
    isDraft: true,
    state: 'OPEN',
    baseRefName: base,
    headRefName: head,
    headRefOid: headSha,
    statusCheckRollup: [{ name: 'E2E CI', status: 'IN_PROGRESS', conclusion: '' }],
  };
  write(state);
  process.stdout.write(state.url + '\\n');
} else if (args[0] === 'pr' && args[1] === 'view') {
  const state = read();
  if (!state) process.exit(8);
  process.stdout.write(JSON.stringify(state) + '\\n');
} else {
  process.stderr.write('unsupported fake gh command: ' + args.join(' ') + '\\n');
  process.exit(9);
}
`;
  writeFileSync(scriptPath, source, 'utf8');
  if (isWindows) {
    const csharpPath = join(bin, 'GhFixture.cs');
    const executablePath = join(bin, 'gh.exe');
    const csharp = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;

public static class GhFixture {
  private static string Field(string[] args, string name) {
    int index = Array.IndexOf(args, name);
    return index >= 0 && index + 1 < args.Length ? args[index + 1] : "";
  }

  private static string Escape(string value) {
    return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
  }

  private static string PullRequest(string head, string baseBranch, string headSha) {
    return "{\"number\":71,\"url\":\"https://github.com/ade-e2e/managed/pull/71\","
      + "\"isDraft\":true,\"state\":\"OPEN\",\"baseRefName\":\"" + Escape(baseBranch) + "\","
      + "\"headRefName\":\"" + Escape(head) + "\",\"headRefOid\":\"" + Escape(headSha) + "\","
      + "\"statusCheckRollup\":[{\"name\":\"E2E CI\",\"status\":\"IN_PROGRESS\",\"conclusion\":\"\"}]}";
  }

  private static string InspectorRollup() {
    return "[{\"__typename\":\"CheckRun\",\"name\":\"E2E Build\",\"status\":\"COMPLETED\",\"conclusion\":\"SUCCESS\"},"
      + "{\"__typename\":\"CheckRun\",\"name\":\"E2E Tests\",\"status\":\"COMPLETED\",\"conclusion\":\"FAILURE\"},"
      + "{\"__typename\":\"StatusContext\",\"context\":\"E2E Lint\",\"state\":\"PENDING\"}]";
  }

  private static string InspectorPullRequest() {
    return "{\"number\":42,\"title\":\"Improve repository inspector fixture\","
      + "\"url\":\"https://github.com/ade-e2e/managed/pull/42\","
      + "\"author\":{\"login\":\"e2e-reviewer\"},\"isDraft\":false,"
      + "\"updatedAt\":\"2026-07-19T12:00:00Z\","
      + "\"headRefName\":\"feature/inspector\",\"baseRefName\":\"main\","
      + "\"reviewDecision\":\"REVIEW_REQUIRED\",\"changedFiles\":3,"
      + "\"additions\":21,\"deletions\":4,"
      + "\"statusCheckRollup\":" + InspectorRollup() + "}";
  }

  private static string PublishedListEntry(string head, string baseBranch) {
    return "{\"number\":71,\"title\":\"ADE: Managed E2E Run\","
      + "\"url\":\"https://github.com/ade-e2e/managed/pull/71\","
      + "\"author\":{\"login\":\"ade-bot\"},\"isDraft\":true,"
      + "\"updatedAt\":\"2026-07-19T13:00:00Z\","
      + "\"headRefName\":\"" + Escape(head) + "\",\"baseRefName\":\"" + Escape(baseBranch) + "\","
      + "\"reviewDecision\":\"REVIEW_REQUIRED\",\"changedFiles\":2,"
      + "\"additions\":2,\"deletions\":0,"
      + "\"statusCheckRollup\":[{\"name\":\"E2E CI\",\"status\":\"IN_PROGRESS\",\"conclusion\":\"\"}]}";
  }

  public static int Main(string[] args) {
    string statePath = Environment.GetEnvironmentVariable("ADE_E2E_FAKE_GH_STATE");
    if (args.Length >= 2 && args[0] == "auth" && args[1] == "status") {
      Console.WriteLine("authenticated fixture");
      return 0;
    }
    if (args.Length >= 2 && args[0] == "repo" && args[1] == "view") {
      Console.WriteLine("{\"nameWithOwner\":\"ade-e2e/managed\"}");
      return 0;
    }
    if (args.Length >= 2 && args[0] == "pr" && args[1] == "list") {
      if (args.Contains("--limit")) {
        string listPath = statePath + ".list";
        Console.WriteLine(File.Exists(listPath)
          ? "[" + InspectorPullRequest() + "," + File.ReadAllText(listPath).Trim() + "]"
          : "[" + InspectorPullRequest() + "]");
      } else {
        Console.WriteLine(File.Exists(statePath) ? "[" + File.ReadAllText(statePath).Trim() + "]" : "[]");
      }
      return 0;
    }
    if (args.Length >= 2 && args[0] == "pr" && args[1] == "create") {
      string head = Field(args, "--head");
      string baseBranch = Field(args, "--base");
      if (!args.Contains("--draft") || head.Length == 0 || baseBranch.Length == 0) return 7;
      var info = new ProcessStartInfo("git", "rev-parse HEAD");
      info.UseShellExecute = false;
      info.RedirectStandardOutput = true;
      info.CreateNoWindow = true;
      using (var process = Process.Start(info)) {
        string headSha = process.StandardOutput.ReadToEnd().Trim();
        process.WaitForExit();
        if (process.ExitCode != 0) return 8;
        File.WriteAllText(statePath, PullRequest(head, baseBranch, headSha) + Environment.NewLine);
        File.WriteAllText(statePath + ".list", PublishedListEntry(head, baseBranch) + Environment.NewLine);
      }
      Console.WriteLine("https://github.com/ade-e2e/managed/pull/71");
      return 0;
    }
    if (args.Length >= 3 && args[0] == "pr" && args[1] == "view" && args[2] == "42") {
      Console.WriteLine("{\"number\":42,\"url\":\"https://github.com/ade-e2e/managed/pull/42\","
        + "\"statusCheckRollup\":" + InspectorRollup() + "}");
      return 0;
    }
    if (args.Length >= 2 && args[0] == "pr" && args[1] == "view") {
      if (!File.Exists(statePath)) return 8;
      Console.WriteLine(File.ReadAllText(statePath).Trim());
      return 0;
    }
    Console.Error.WriteLine("unsupported fake gh command: " + string.Join(" ", args));
    return 9;
  }
}
`;
    writeFileSync(csharpPath, csharp, 'utf8');
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -Path $env:ADE_FIXTURE_CS -OutputAssembly $env:ADE_FIXTURE_EXE -OutputType ConsoleApplication',
    ], {
      env: { ...process.env, ADE_FIXTURE_CS: csharpPath, ADE_FIXTURE_EXE: executablePath },
      timeout: 60_000,
      windowsHide: true,
    });
  } else {
    const launcher = join(bin, 'gh');
    writeFileSync(launcher, '#!/bin/sh\nexec node "$(dirname "$0")/gh.cjs" "$@"\n', 'utf8');
    chmodSync(launcher, 0o755);
  }
  return { bin, statePath };
}
