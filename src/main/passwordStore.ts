/**
 * Which `--password-store` switch Electron needs on Linux, if any.
 *
 * Chromium picks the safeStorage backend from XDG_CURRENT_DESKTOP. Desktops it
 * does not recognise — Hyprland, Sway, niri, i3 and other tiling setups —
 * fall back to `basic_text`, which ADE rightly refuses to store keys in, even
 * when a Secret Service (GNOME Keyring, KeePassXC) is running on the session
 * bus. Asking for libsecret there is safe: without a Secret Service,
 * `isEncryptionAvailable()` stays false and ADE reports it exactly as before.
 */

/** Desktops Chromium already maps to a real keyring (libsecret or kwallet). */
const RECOGNISED_DESKTOPS = [
  'gnome', 'unity', 'pantheon', 'xfce', 'cinnamon', 'deepin', 'ukui', 'kde', 'lxqt', 'budgie',
];

export function linuxPasswordStoreSwitch(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
): 'gnome-libsecret' | undefined {
  if (platform !== 'linux') return undefined;
  // An explicit choice (launcher, packaging, the user) always wins.
  if (argv.some((arg) => arg === '--password-store' || arg.startsWith('--password-store='))) return undefined;
  if (!env['DBUS_SESSION_BUS_ADDRESS']) return undefined;
  const desktops = (env['XDG_CURRENT_DESKTOP'] ?? '').toLowerCase().split(':').filter(Boolean);
  if (desktops.some((desktop) => RECOGNISED_DESKTOPS.some((known) => desktop.includes(known)))) return undefined;
  return 'gnome-libsecret';
}
