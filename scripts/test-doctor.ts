/**
 * `pnpm doctor` verdicts and the Linux keyring switch. Both are pure: the
 * facts and environment are fixtures, so this runs identically on every host.
 */

import {
  doctorExitCode, evaluateDoctor, formatDoctor, type DoctorFacts,
} from './helpers/doctor';
import { linuxPasswordStoreSwitch } from '../src/main/passwordStore';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}`, detail ?? '');
  }
}

function healthy(): DoctorFacts {
  return {
    platform: 'linux',
    nodeVersion: 'v22.12.0',
    pnpmVersion: '9.15.9',
    pnpmPin: 'pnpm@9.15.9',
    gitVersion: '2.51.0',
    electronBinary: true,
    ptyUnderElectron: { ok: true, detail: '' },
    clis: { claude: '2.1.283', codex: undefined },
    secretService: true,
  };
}

function testDoctorVerdicts(): void {
  const ok = evaluateDoctor(healthy());
  check('healthy checkout: every check ok and exit 0',
    ok.every((item) => item.level === 'ok') && doctorExitCode(ok) === 0, ok);
  check('healthy checkout: report says ready and names the start command',
    /ADE is ready\. Start it with `pnpm dev`/.test(formatDoctor(ok)));

  const oldNode = evaluateDoctor({ ...healthy(), nodeVersion: 'v20.18.0' });
  check('Node older than 22 fails with an install hint',
    oldNode.find((item) => item.id === 'node')?.level === 'fail' && doctorExitCode(oldNode) === 1);
  check('a newer Node major is accepted',
    evaluateDoctor({ ...healthy(), nodeVersion: 'v26.8.2' }).find((item) => item.id === 'node')?.level === 'ok');

  const noPnpm = evaluateDoctor({ ...healthy(), pnpmVersion: undefined });
  check('missing pnpm fails and points at corepack with the pinned version',
    noPnpm.find((item) => item.id === 'pnpm')?.fix?.includes('pnpm@9.15.9') === true);
  check('a different pnpm version only warns',
    evaluateDoctor({ ...healthy(), pnpmVersion: '10.4.0' }).find((item) => item.id === 'pnpm')?.level === 'warn');

  const noElectron = evaluateDoctor({ ...healthy(), electronBinary: false, ptyUnderElectron: undefined });
  const electron = noElectron.find((item) => item.id === 'electron');
  check('skipped Electron download fails as automatically fixable via install.js',
    electron?.level === 'fail' && electron.autoFixable === true && /install\.js/.test(electron.fix ?? ''));
  check('without an Electron binary the node-pty probe is not reported as a verdict',
    !noElectron.some((item) => item.id === 'node-pty'));

  const badPty = evaluateDoctor({
    ...healthy(), ptyUnderElectron: { ok: false, detail: 'NODE_MODULE_VERSION 127 vs 135' },
  });
  const pty = badPty.find((item) => item.id === 'node-pty');
  check('node-pty that does not load in Electron fails as fixable via rebuild:pty, with the loader detail',
    pty?.level === 'fail' && pty.autoFixable === true && pty.fix === 'pnpm run rebuild:pty'
      && pty.detail.includes('NODE_MODULE_VERSION'));

  const noClis = evaluateDoctor({ ...healthy(), clis: { claude: undefined, codex: undefined } });
  check('no agent CLI is a warning, not a failure',
    noClis.find((item) => item.id === 'clis')?.level === 'warn' && doctorExitCode(noClis) === 0);

  const noKeyring = evaluateDoctor({ ...healthy(), secretService: false });
  check('Linux without a Secret Service warns about key storage',
    noKeyring.find((item) => item.id === 'keyring')?.level === 'warn');
  check('the keyring check is Linux-only',
    !evaluateDoctor({ ...healthy(), platform: 'win32', secretService: undefined })
      .some((item) => item.id === 'keyring'));
  check('failures print their fix and the --fix hint',
    /-> pnpm run rebuild:pty/.test(formatDoctor(badPty)) && /pnpm doctor --fix/.test(formatDoctor(badPty)));
}

function testPasswordStoreSwitch(): void {
  const bus = { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' };
  check('Hyprland gets libsecret',
    linuxPasswordStoreSwitch('linux', { ...bus, XDG_CURRENT_DESKTOP: 'Hyprland' }, []) === 'gnome-libsecret');
  check('an unset desktop (plain WM, WSLg) gets libsecret',
    linuxPasswordStoreSwitch('linux', { ...bus }, []) === 'gnome-libsecret');
  check('GNOME is left to Chromium (already libsecret)',
    linuxPasswordStoreSwitch('linux', { ...bus, XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }, []) === undefined);
  check('KDE is left to Chromium (kwallet)',
    linuxPasswordStoreSwitch('linux', { ...bus, XDG_CURRENT_DESKTOP: 'KDE' }, []) === undefined);
  check('an explicit --password-store wins',
    linuxPasswordStoreSwitch('linux', { ...bus, XDG_CURRENT_DESKTOP: 'sway' }, ['--password-store=basic']) === undefined
      && linuxPasswordStoreSwitch('linux', { ...bus }, ['--password-store', 'kwallet5']) === undefined);
  check('no session bus: nothing to ask, no switch',
    linuxPasswordStoreSwitch('linux', { XDG_CURRENT_DESKTOP: 'Hyprland' }, []) === undefined);
  check('Windows and macOS are untouched',
    linuxPasswordStoreSwitch('win32', { ...bus }, []) === undefined
      && linuxPasswordStoreSwitch('darwin', { ...bus }, []) === undefined);
}

testDoctorVerdicts();
testPasswordStoreSwitch();
console.log(`\nDoctor: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
