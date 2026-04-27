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

export interface PickerItem {
  label: string;
  hint?: string;
}

export async function pickOption(
  prompt: string,
  items: PickerItem[],
  defaultIndex = 0,
): Promise<number> {
  if (items.length === 0) throw new Error('pickOption: items must be non-empty');
  if (!process.stdin.isTTY) {
    process.stdout.write(`${prompt}\n`);
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const hint = it.hint ? `  ${it.hint}` : '';
      process.stdout.write(`  ${i + 1}. ${it.label}${hint}\n`);
    }
    while (true) {
      const ans = (await ask(`Pick (1-${items.length}):`)).trim();
      const n = Number.parseInt(ans, 10);
      if (Number.isInteger(n) && n >= 1 && n <= items.length) return n - 1;
      const byLabel = items.findIndex((it) => it.label === ans);
      if (byLabel !== -1) return byLabel;
      process.stderr.write(`cc-use: invalid choice '${ans}'.\n`);
    }
  }

  let cursor = Math.max(0, Math.min(defaultIndex, items.length - 1));
  const labelWidth = Math.max(...items.map((it) => it.label.length));

  process.stdout.write(`${prompt}\n`);
  process.stdout.write(`\x1b[2m(↑/↓ to move, Enter to select, Ctrl-C to cancel)\x1b[0m\n`);

  const drawAll = (firstRender: boolean) => {
    const cols = process.stdout.columns ?? 80;
    // marker(1) + space(1) + label + spacer(2) + hint
    const visiblePrefix = 2 + labelWidth + 2;
    const maxHint = Math.max(0, cols - visiblePrefix - 1);
    if (!firstRender) {
      process.stdout.write(`\x1b[${items.length}A`);
    }
    for (let i = 0; i < items.length; i++) {
      process.stdout.write('\x1b[2K');
      const it = items[i]!;
      const padded = it.label.padEnd(labelWidth);
      const hintText = it.hint ? truncate(it.hint, maxHint) : '';
      const hint = hintText ? `  \x1b[2m${hintText}\x1b[0m` : '';
      if (i === cursor) {
        process.stdout.write(`\x1b[36m›\x1b[0m \x1b[36m${padded}\x1b[0m${hint}\n`);
      } else {
        process.stdout.write(`  ${padded}${hint}\n`);
      }
    }
  };

  drawAll(true);

  return new Promise<number>((resolve, reject) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      try {
        process.stdin.setRawMode(false);
      } catch {
        // ignore
      }
      process.stdin.pause();
    };

    const onData = (chunk: string) => {
      if (chunk === '\x03') {
        cleanup();
        process.stdout.write('\n');
        reject(new Error('cancelled'));
        return;
      }
      if (chunk === '\r' || chunk === '\n') {
        cleanup();
        return resolve(cursor);
      }
      if (chunk === '\x1b[A' || chunk === 'k') {
        cursor = (cursor - 1 + items.length) % items.length;
        drawAll(false);
        return;
      }
      if (chunk === '\x1b[B' || chunk === 'j') {
        cursor = (cursor + 1) % items.length;
        drawAll(false);
        return;
      }
      if (chunk.length === 1 && chunk >= '1' && chunk <= '9') {
        const n = Number.parseInt(chunk, 10);
        if (n >= 1 && n <= items.length) {
          cursor = n - 1;
          drawAll(false);
        }
      }
    };

    process.stdin.on('data', onData);
  });
}

function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  if (max === 1) return '…';
  return s.slice(0, max - 1) + '…';
}

export async function confirm(prompt: string, defaultYes = true): Promise<boolean> {
  const idx = await pickOption(
    prompt,
    [{ label: 'Yes' }, { label: 'No' }],
    defaultYes ? 0 : 1,
  );
  return idx === 0;
}

export async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  if (process.stdin.isTTY) return confirm(question, defaultYes);
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
