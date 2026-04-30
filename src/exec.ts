import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import type { Profile } from './profile.js';

export function buildChildEnv(
  profile: Profile,
  claudeConfigDir: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...base,
    ...profile.env,
    CLAUDE_CONFIG_DIR: claudeConfigDir,
  };
}

export async function spawnClaude(
  profile: Profile,
  claudeArgs: string[],
  opts: { claudeConfigDir: string },
): Promise<number> {
  const { claudeConfigDir } = opts;
  if (!existsSync(claudeConfigDir)) {
    mkdirSync(claudeConfigDir, { recursive: true });
  }

  const childEnv = buildChildEnv(profile, claudeConfigDir);

  const isWin = process.platform === 'win32';

  const child = spawn('claude', claudeArgs, {
    env: childEnv,
    stdio: 'inherit',
    shell: isWin,
  });

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const sig of signals) {
    const h = () => {
      if (!child.killed) {
        try {
          child.kill(sig);
        } catch {
          // ignore
        }
      }
    };
    handlers.set(sig, h);
    process.on(sig, h);
  }
  const cleanup = () => {
    for (const [sig, h] of handlers) process.removeListener(sig, h);
  };

  return new Promise<number>((resolve, reject) => {
    child.on('error', (err: NodeJS.ErrnoException) => {
      cleanup();
      if (err.code === 'ENOENT') {
        process.stderr.write(
          'cc-use: `claude` command not found in PATH.\n' +
            '       Install Claude Code first:\n' +
            '         npm install -g @anthropic-ai/claude-code\n',
        );
        resolve(127);
        return;
      }
      reject(err);
    });
    child.on('exit', (code, signal) => {
      cleanup();
      if (signal) {
        const sigCode = signalExitCode(signal);
        resolve(128 + sigCode);
      } else {
        resolve(code ?? 0);
      }
    });
  });
}

function signalExitCode(sig: NodeJS.Signals): number {
  switch (sig) {
    case 'SIGHUP':
      return 1;
    case 'SIGINT':
      return 2;
    case 'SIGTERM':
      return 15;
    case 'SIGKILL':
      return 9;
    default:
      return 0;
  }
}
