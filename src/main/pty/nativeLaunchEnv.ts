/** A fixed native invocation must see the same PATH/config as its read-only
 * probe. Bash startup hooks/functions could otherwise replace the CLI or trace
 * profile text. Ordinary custom/login/shell sessions retain their environment. */
export function nativeLaunchEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const clean = { ...env };
  if (platform === 'linux') {
    for (const key of Object.keys(clean)) {
      if (['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS', 'BASH_XTRACEFD'].includes(key) || key.startsWith('BASH_FUNC_')) delete clean[key];
    }
  }
  return clean;
}
