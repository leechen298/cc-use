import { unlinkSync, rmSync, existsSync } from 'node:fs';
import { profilePath, sessionDirFor } from './paths.js';
import { profileExists, validateProfileName } from './profile.js';
import { getConfiguredDefaultProfile, setDefaultProfile } from './config.js';

export interface RemoveOptions {
  profile: string;
  yes: boolean;
  deleteSession: boolean;
}

export async function runRemove(opts: RemoveOptions): Promise<number> {
  validateProfileName(opts.profile);

  if (!profileExists(opts.profile)) {
    process.stderr.write(`cc-use: profile '${opts.profile}' not found.\n`);
    return 1;
  }

  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      process.stderr.write(
        `cc-use: non-interactive mode requires --yes to confirm removal.\n`,
      );
      return 1;
    }
    const { confirm } = await import('./wizard.js');
    const prompt = opts.deleteSession
      ? `Remove profile '${opts.profile}' and its isolated session history?`
      : `Remove profile '${opts.profile}'?`;
    const ok = await confirm(prompt);
    if (!ok) {
      process.stdout.write('Aborted.\n');
      return 1;
    }
  }

  unlinkSync(profilePath(opts.profile));
  process.stdout.write(`cc-use: removed profile '${opts.profile}'.\n`);

  const configuredDefault = getConfiguredDefaultProfile();
  if (configuredDefault === opts.profile) {
    setDefaultProfile(undefined);
    process.stdout.write(`cc-use: default profile unset (was '${opts.profile}').\n`);
  }

  if (process.env.CC_USE_DEFAULT === opts.profile) {
    process.stderr.write(
      `cc-use: warning: CC_USE_DEFAULT still points to '${opts.profile}'. ` +
        `Unset or update the environment variable.\n`,
    );
  }

  if (opts.deleteSession) {
    const sessionDir = sessionDirFor(opts.profile);
    if (existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true, force: true });
      process.stdout.write(`cc-use: deleted session history '${sessionDir}'.\n`);
    }
  }

  return 0;
}
