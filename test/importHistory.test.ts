import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const tmp = mkdtempSync(join(tmpdir(), 'cc-use-import-history-test-'));
process.env.CC_USE_DIR = join(tmp, 'cc-use');

const providersDir = join(process.env.CC_USE_DIR, 'providers');
const nativeClaudeDir = join(tmp, 'native-claude');
mkdirSync(providersDir, { recursive: true });
mkdirSync(join(nativeClaudeDir, 'projects'), { recursive: true });
writeFileSync(
  join(providersDir, 'deepseek.json'),
  JSON.stringify({
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_AUTH_TOKEN: 'sk-test',
  }),
);

const importHistoryMod = await import('../src/importHistory.js');
const pathsMod = await import('../src/paths.js');
const { runImportHistory, sanitizeTranscriptRows } = importHistoryMod;
const cliPath = join(process.cwd(), 'src/cli.ts');
const tsxLoaderPath = join(process.cwd(), 'node_modules/tsx/dist/loader.mjs');

test.after(() => rmSync(tmp, { recursive: true, force: true }));

test('runImportHistory copies the current project raw by default', async () => {
  const cwd = join(tmp, 'repo-raw');
  const projectDir = join(nativeClaudeDir, 'projects', encodeCwdToProjectFolder(cwd));
  mkdirSync(projectDir, { recursive: true });
  const rawJsonl =
    JSON.stringify({
      uuid: 'a1',
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'kept raw' }] },
    }) + '\n';
  writeFileSync(join(projectDir, 'session.jsonl'), rawJsonl);
  writeFileSync(join(projectDir, 'note.txt'), 'plain file');

  const code = await runImportHistory({
    profile: 'deepseek',
    all: false,
    sanitize: false,
    nativeClaudeDir,
    cwd,
  });

  assert.equal(code, 0);
  const targetProjectDir = join(pathsMod.sessionDirFor('deepseek'), 'projects', encodeCwdToProjectFolder(cwd));
  assert.equal(readFileSync(join(targetProjectDir, 'session.jsonl'), 'utf8'), rawJsonl);
  assert.equal(readFileSync(join(targetProjectDir, 'note.txt'), 'utf8'), 'plain file');
});

test('runImportHistory --sanitize cleans jsonl transcripts while preserving readable context', async () => {
  const cwd = join(tmp, 'repo-sanitize');
  const projectDir = join(nativeClaudeDir, 'projects', encodeCwdToProjectFolder(cwd));
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, 'session.jsonl'),
    [
      JSON.stringify({
        uuid: 'u1',
        parentUuid: null,
        type: 'user',
        message: { role: 'user', content: 'hello' },
      }),
      JSON.stringify({
        uuid: 'a1',
        parentUuid: 'u1',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'internal' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/a.ts' } },
          ],
        },
      }),
    ].join('\n') + '\n',
  );

  const code = await runImportHistory({
    profile: 'deepseek',
    all: false,
    sanitize: true,
    nativeClaudeDir,
    cwd,
  });

  assert.equal(code, 0);
  const targetProjectDir = join(pathsMod.sessionDirFor('deepseek'), 'projects', encodeCwdToProjectFolder(cwd));
  const imported = readFileSync(join(targetProjectDir, 'session.jsonl'), 'utf8');
  assert.doesNotMatch(imported, /"type":"thinking"/);
  assert.match(imported, /\[cc-use sanitized tool_use block: Read toolu_1\]/);
});

test('runImportHistory --all imports every native project directory and skips loose files', async () => {
  const projectsDir = join(nativeClaudeDir, 'projects');
  const projectA = join(projectsDir, '-tmp-project-a');
  const projectB = join(projectsDir, '-tmp-project-b');
  mkdirSync(projectA, { recursive: true });
  mkdirSync(projectB, { recursive: true });
  writeFileSync(join(projectA, 'a.jsonl'), JSON.stringify({ type: 'user', message: { content: 'a' } }) + '\n');
  writeFileSync(join(projectB, 'b.jsonl'), JSON.stringify({ type: 'user', message: { content: 'b' } }) + '\n');
  writeFileSync(join(projectsDir, 'loose.jsonl'), JSON.stringify({ type: 'user' }) + '\n');

  const code = await runImportHistory({
    profile: 'deepseek',
    all: true,
    sanitize: false,
    nativeClaudeDir,
  });

  assert.equal(code, 0);
  const targetProjects = join(pathsMod.sessionDirFor('deepseek'), 'projects');
  assert.equal(readFileSync(join(targetProjects, '-tmp-project-a', 'a.jsonl'), 'utf8').includes('"a"'), true);
  assert.equal(readFileSync(join(targetProjects, '-tmp-project-b', 'b.jsonl'), 'utf8').includes('"b"'), true);
  assert.throws(() => readFileSync(join(targetProjects, 'loose.jsonl'), 'utf8'));
});

test('runImportHistory returns 1 when the profile does not exist', async () => {
  const code = await runImportHistory({
    profile: 'missing',
    all: true,
    sanitize: false,
    nativeClaudeDir,
  });

  assert.equal(code, 1);
});

test('runImportHistory returns 1 when the native projects directory is missing', async () => {
  const code = await runImportHistory({
    profile: 'deepseek',
    all: true,
    sanitize: false,
    nativeClaudeDir: join(tmp, 'missing-native-claude'),
  });

  assert.equal(code, 1);
});

test('runImportHistory returns 1 when the current project has no native history', async () => {
  const cwd = join(tmp, 'no-history');
  const code = await runImportHistory({
    profile: 'deepseek',
    all: false,
    sanitize: false,
    nativeClaudeDir,
    cwd,
  });

  assert.equal(code, 1);
});

test('CLI import-history defaults to raw transcript import', () => {
  const fixture = createCliFixture('cli-raw');
  const result = spawnSync(
    process.execPath,
    ['--import', tsxLoaderPath, cliPath, 'import-history', 'deepseek'],
    {
      cwd: fixture.cwd,
      env: { ...process.env, CC_USE_DIR: fixture.ccUseDir, HOME: fixture.home },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const imported = readFileSync(join(fixture.ccUseDir, 'sessions/deepseek/projects', fixture.projectFolder, 'session.jsonl'), 'utf8');
  assert.match(imported, /"type":"thinking"/);
  assert.doesNotMatch(result.stdout, /sanitized/);
});

test('CLI import-history --sanitize enables provider-compatible cleanup', () => {
  const fixture = createCliFixture('cli-sanitize');
  const result = spawnSync(
    process.execPath,
    ['--import', tsxLoaderPath, cliPath, 'import-history', 'deepseek', '--sanitize'],
    {
      cwd: fixture.cwd,
      env: { ...process.env, CC_USE_DIR: fixture.ccUseDir, HOME: fixture.home },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const imported = readFileSync(join(fixture.ccUseDir, 'sessions/deepseek/projects', fixture.projectFolder, 'session.jsonl'), 'utf8');
  assert.doesNotMatch(imported, /"type":"thinking"/);
  assert.match(imported, /\[cc-use sanitized tool_use block: Read toolu_1\]/);
  assert.match(result.stdout, /sanitized 1 transcript file/);
});

test('sanitizeTranscriptRows removes thinking-only assistant nodes and repairs parent links', () => {
  const rows = [
    {
      uuid: 'u1',
      parentUuid: null,
      type: 'user',
      message: { role: 'user', content: 'hello' },
    },
    {
      uuid: 'a1',
      parentUuid: 'u1',
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'internal' }],
      },
    },
    {
      uuid: 'a2',
      parentUuid: 'a1',
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
      },
    },
  ];

  const result = sanitizeTranscriptRows(rows);
  assert.equal(result.changed, true);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[1]?.parentUuid, 'u1');
});

test('sanitizeTranscriptRows strips thinking blocks from mixed-content assistant messages', () => {
  const rows = [
    {
      uuid: 'a1',
      parentUuid: null,
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'internal' },
          { type: 'text', text: 'kept' },
        ],
      },
    },
  ];

  const result = sanitizeTranscriptRows(rows);
  assert.equal(result.changed, true);
  assert.deepEqual(result.rows[0]?.message, {
    role: 'assistant',
    content: [{ type: 'text', text: 'kept' }],
  });
});

test('sanitizeTranscriptRows textualizes historical tool blocks to break thinking-mode tool continuity', () => {
  const rows = [
    {
      uuid: 'a1',
      parentUuid: null,
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Read',
            input: { file_path: '/tmp/example.txt' },
          },
        ],
      },
    },
    {
      uuid: 'u1',
      parentUuid: 'a1',
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'file body',
          },
        ],
      },
    },
  ];

  const result = sanitizeTranscriptRows(rows);
  assert.equal(result.changed, true);
  assert.deepEqual(result.rows[0]?.message, {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text:
          '[cc-use sanitized tool_use block: Read toolu_1]\n' +
          '{"id":"toolu_1","input":{"file_path":"/tmp/example.txt"},"name":"Read","type":"tool_use"}',
      },
    ],
  });
  assert.deepEqual(result.rows[1]?.message, {
    role: 'user',
    content: [
      {
        type: 'text',
        text:
          '[cc-use sanitized tool_result block: tool_use_id=toolu_1]\n' +
          '{"content":"file body","tool_use_id":"toolu_1","type":"tool_result"}',
      },
    ],
  });
});

test('sanitizeTranscriptRows drops redacted thinking and textualizes unsupported DeepSeek blocks', () => {
  const rows = [
    {
      uuid: 'a1',
      parentUuid: null,
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'redacted_thinking', data: 'opaque' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
          { type: 'mcp_tool_result', tool_use_id: 'mcp_1', content: [{ type: 'text', text: 'ok' }] },
        ],
      },
    },
  ];

  const result = sanitizeTranscriptRows(rows);
  const content = result.rows[0]?.message && (result.rows[0].message as { content?: unknown }).content;
  assert.equal(result.changed, true);
  assert.equal(Array.isArray(content), true);
  assert.equal((content as Array<{ type: string; text: string }>).length, 2);
  assert.match((content as Array<{ type: string; text: string }>)[0]!.text, /^\[cc-use sanitized image block\]/);
  assert.match(
    (content as Array<{ type: string; text: string }>)[1]!.text,
    /^\[cc-use sanitized mcp_tool_result block: tool_use_id=mcp_1\]/,
  );
});

test('sanitizeTranscriptRows leaves already-safe transcripts unchanged', () => {
  const rows = [
    {
      uuid: 'u1',
      parentUuid: null,
      type: 'user',
      message: { role: 'user', content: 'hello' },
    },
  ];

  const result = sanitizeTranscriptRows(rows);
  assert.equal(result.changed, false);
  assert.deepEqual(result.rows, rows);
});

function encodeCwdToProjectFolder(cwd: string): string {
  return cwd.replace(/[\\/]/g, '-');
}

function createCliFixture(name: string): { home: string; ccUseDir: string; cwd: string; projectFolder: string } {
  const root = join(tmp, name);
  const home = join(root, 'home');
  const ccUseDir = join(root, 'cc-use');
  const cwd = join(root, 'repo');
  const providersDir = join(ccUseDir, 'providers');
  mkdirSync(cwd, { recursive: true });
  const realCwd = realpathSync(cwd);
  const projectFolder = encodeCwdToProjectFolder(realCwd);
  const projectDir = join(home, '.claude', 'projects', projectFolder);

  mkdirSync(providersDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(providersDir, 'deepseek.json'),
    JSON.stringify({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'sk-test',
    }),
  );
  writeFileSync(
    join(projectDir, 'session.jsonl'),
    JSON.stringify({
      uuid: 'a1',
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'internal' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/a.ts' } },
        ],
      },
    }) + '\n',
  );

  return { home, ccUseDir, cwd: realCwd, projectFolder };
}
