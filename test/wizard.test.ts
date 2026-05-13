import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';

const wizard = await import('../src/wizard.js');

class CaptureStream extends Writable {
  output = '';
  columns = 32;

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.output += chunk.toString();
    callback();
  }
}

class FakeTtyInput extends EventEmitter {
  isTTY = true;
  rawMode = false;
  resumed = false;
  encoding = '';

  setRawMode(value: boolean): void {
    this.rawMode = value;
  }

  resume(): void {
    this.resumed = true;
  }

  pause(): void {
    this.resumed = false;
  }

  setEncoding(encoding: BufferEncoding): void {
    this.encoding = encoding;
  }
}

function inputFrom(text: string): PassThrough {
  const input = new PassThrough();
  Object.defineProperty(input, 'isTTY', { value: false, configurable: true });
  input.end(text);
  return input;
}

async function withProcessIo<T>(
  stdin: unknown,
  fn: () => Promise<T>,
): Promise<{ result: T; stdout: string; stderr: string }> {
  const stdout = new CaptureStream();
  const stderr = new CaptureStream();
  const stdinDesc = Object.getOwnPropertyDescriptor(process, 'stdin');
  const stdoutDesc = Object.getOwnPropertyDescriptor(process, 'stdout');
  const stderrDesc = Object.getOwnPropertyDescriptor(process, 'stderr');
  Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
  Object.defineProperty(process, 'stdout', { value: stdout, configurable: true });
  Object.defineProperty(process, 'stderr', { value: stderr, configurable: true });
  try {
    const result = await fn();
    return { result, stdout: stdout.output, stderr: stderr.output };
  } finally {
    Object.defineProperty(process, 'stdin', stdinDesc!);
    Object.defineProperty(process, 'stdout', stdoutDesc!);
    Object.defineProperty(process, 'stderr', stderrDesc!);
  }
}

test('ask returns the default value when non-TTY input is blank', async () => {
  const { result, stdout } = await withProcessIo(inputFrom('\n'), () =>
    wizard.ask('Profile name:', 'deepseek'),
  );
  assert.equal(result, 'deepseek');
  assert.match(stdout, /Profile name: \[deepseek\]/);
});

test('pickOption accepts labels from non-TTY input', async () => {
  const { result, stdout } = await withProcessIo(inputFrom('Beta\n'), () =>
    wizard.pickOption(
      'Pick a provider:',
      [
        { label: 'Alpha', hint: 'first provider' },
        { label: 'Beta' },
      ],
    ),
  );
  assert.equal(result, 1);
  assert.match(stdout, /Pick a provider:/);
  assert.match(stdout, /1\. Alpha  first provider/);
});

test('askYesNo honors non-TTY defaults and yes answers', async () => {
  const blank = await withProcessIo(inputFrom('\n'), () => wizard.askYesNo('Continue?', false));
  assert.equal(blank.result, false);

  const yes = await withProcessIo(inputFrom('yes\n'), () => wizard.askYesNo('Continue?', false));
  assert.equal(yes.result, true);
});

test('askHidden falls back to visible input outside TTY', async () => {
  const { result, stderr } = await withProcessIo(inputFrom('sk-test\n'), () =>
    wizard.askHidden('API key:'),
  );
  assert.equal(result, 'sk-test');
  assert.match(stderr, /stdin is not a TTY/);
});

test('pickOption supports TTY arrow movement and enter selection', async () => {
  const input = new FakeTtyInput();
  const pending = withProcessIo(input, () =>
    wizard.pickOption(
      'Pick:',
      [
        { label: 'Alpha', hint: 'long hint that should be truncated in a narrow terminal' },
        { label: 'Beta' },
        { label: 'Gamma' },
      ],
      1,
    ),
  );
  setImmediate(() => {
    input.emit('data', '\x1b[B');
    input.emit('data', '\r');
  });
  const { result, stdout } = await pending;
  assert.equal(result, 2);
  assert.equal(input.rawMode, false);
  assert.equal(input.resumed, false);
  assert.match(stdout, /Pick:/);
});

test('pickOption supports TTY numeric movement and cancellation', async () => {
  const numericInput = new FakeTtyInput();
  const numeric = withProcessIo(numericInput, () =>
    wizard.pickOption('Pick:', [{ label: 'One' }, { label: 'Two' }, { label: 'Three' }]),
  );
  setImmediate(() => {
    numericInput.emit('data', '3');
    numericInput.emit('data', '\n');
  });
  assert.equal((await numeric).result, 2);

  const cancelInput = new FakeTtyInput();
  const cancel = withProcessIo(cancelInput, () =>
    wizard.pickOption('Pick:', [{ label: 'One' }, { label: 'Two' }]),
  );
  setImmediate(() => cancelInput.emit('data', '\x03'));
  await assert.rejects(cancel, /cancelled/);
  assert.equal(cancelInput.rawMode, false);
  assert.equal(cancelInput.resumed, false);
});

test('askHidden supports TTY masking, backspace, Ctrl-D, and cancellation', async () => {
  const submitInput = new FakeTtyInput();
  const submit = withProcessIo(submitInput, () => wizard.askHidden('Secret:'));
  setImmediate(() => {
    submitInput.emit('data', 'a');
    submitInput.emit('data', 'b');
    submitInput.emit('data', '\x7f');
    submitInput.emit('data', 'c');
    submitInput.emit('data', '\x04');
  });
  const submitted = await submit;
  assert.equal(submitted.result, 'ac');
  assert.match(submitted.stdout, /\*\*\x08 \x08\*/);

  const cancelInput = new FakeTtyInput();
  const cancel = withProcessIo(cancelInput, () => wizard.askHidden('Secret:'));
  setImmediate(() => cancelInput.emit('data', '\x03'));
  await assert.rejects(cancel, /cancelled/);
  assert.equal(cancelInput.rawMode, false);
  assert.equal(cancelInput.resumed, false);
});
