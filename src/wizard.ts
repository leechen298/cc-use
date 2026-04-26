import { createInterface } from 'node:readline';

export async function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise<string>((resolve) => {
    rl.question(`${question}${suffix} `, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed.length === 0 && defaultValue !== undefined ? defaultValue : trimmed);
    });
  });
}

export async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await ask(`${question} (${hint})`)).toLowerCase();
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}

export async function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      'cc-use: stdin is not a TTY; input will not be hidden.\n',
    );
    return ask(question);
  }
  return new Promise<string>((resolve, reject) => {
    process.stdout.write(`${question} `);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let buf = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 0x03) {
          // Ctrl-C
          cleanup();
          process.stdout.write('\n');
          reject(new Error('cancelled'));
          return;
        }
        if (code === 0x0d || code === 0x0a) {
          // Enter
          cleanup();
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (code === 0x7f || code === 0x08) {
          // Backspace
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (code === 0x04) {
          // Ctrl-D — submit current buffer
          cleanup();
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (code >= 0x20) {
          buf += ch;
          process.stdout.write('*');
        }
      }
    };
    function cleanup() {
      process.stdin.removeListener('data', onData);
      try {
        process.stdin.setRawMode(false);
      } catch {
        // ignore
      }
      process.stdin.pause();
    }
    process.stdin.on('data', onData);
  });
}
