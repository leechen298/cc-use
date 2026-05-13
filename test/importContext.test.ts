import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const tmp = mkdtempSync(join(tmpdir(), 'cc-use-import-context-test-'));
process.env.CC_USE_DIR = join(tmp, 'cc-use');

const providersDir = join(process.env.CC_USE_DIR, 'providers');
mkdirSync(providersDir, { recursive: true });

const importContextMod = await import('../src/importContext.js');
const pathsMod = await import('../src/paths.js');
const { runImportContext } = importContextMod;
const cliPath = join(process.cwd(), 'dist/cli.js');

test.after(() => rmSync(tmp, { recursive: true, force: true }));

function setupProfile(name: string): { nativeDir: string; profile: string; targetDir: string } {
  const nativeDir = join(tmp, 'native-' + name);
  const profile = 'deepseek-' + name;
  const targetDir = pathsMod.sessionDirFor(profile);
  mkdirSync(nativeDir, { recursive: true });
  writeFileSync(
    join(providersDir, profile + '.json'),
    JSON.stringify({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'sk-test',
    }),
  );
  return { nativeDir, profile, targetDir };
}

function makeProject(name: string, nativeDir: string): string {
  const dir = join(nativeDir, 'projects', name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSettings(
  nativeDir: string,
  extra: Record<string, unknown> = {},
): void {
  writeFileSync(
    join(nativeDir, 'settings.json'),
    JSON.stringify({ theme: 'dark', effortLevel: 'high', ...extra }),
  );
}

test('runImportContext --dry-run prints plan and writes nothing', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('dryrun');
  const projectDir = makeProject('dryrun-project', nativeDir);
  writeFileSync(join(projectDir, 'a.jsonl'), '{"type":"user"}\n');
  makeSettings(nativeDir);

  const code = await runImportContext({
    profile,
    dryRun: true,
    force: false,
    include: [],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  assert.equal(
    existsSync(join(targetDir, 'projects', 'dryrun-project')),
    false,
    'dry-run must not create directories',
  );
});

test('runImportContext default import copies projects and settings-safe', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('default');
  const projectDir = makeProject('default-project', nativeDir);
  writeFileSync(join(projectDir, 'session.jsonl'), '{"type":"user"}\n');
  makeSettings(nativeDir);

  const code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: [],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  assert.equal(
    existsSync(join(targetDir, 'projects', 'default-project', 'session.jsonl')),
    true,
  );
  const settings = JSON.parse(
    readFileSync(join(targetDir, 'settings.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.effortLevel, 'high');
});

test('runImportContext settings-safe skips unknown and risky fields', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('settingsfilter');
  makeSettings(nativeDir, {
    env: { SECRET: 'x' },
    apiKeyHelper: 'some-helper',
    hooks: { pre: 'cmd' },
    unknownField: true,
  });

  const code = await runImportContext({
    profile,
    dryRun: false,
    force: true,
    include: ['settings-safe'],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  const settings = JSON.parse(
    readFileSync(join(targetDir, 'settings.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(settings.theme, 'dark');
  assert.equal('env' in settings, false);
  assert.equal('apiKeyHelper' in settings, false);
  assert.equal('hooks' in settings, false);
  assert.equal('unknownField' in settings, false);
});

test('runImportContext reports missing profile', async () => {
  const code = await runImportContext({
    profile: 'missing',
    dryRun: false,
    force: false,
    include: [],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: join(tmp, 'nonexistent'),
  });
  assert.equal(code, 1);
});

test('runImportContext detects conflicts without --force', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('conflict');
  const projectDir = makeProject('conflict-project', nativeDir);
  writeFileSync(join(projectDir, 'file.txt'), 'v1');
  makeSettings(nativeDir);

  await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: [],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  writeFileSync(join(projectDir, 'file.txt'), 'v2');

  const code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: [],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 1);
  assert.equal(
    readFileSync(join(targetDir, 'projects', 'conflict-project', 'file.txt'), 'utf8'),
    'v1',
  );
});

test('runImportContext overwrites with --force', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('force');
  const projectDir = makeProject('force-project', nativeDir);
  writeFileSync(join(projectDir, 'file.txt'), 'v1');
  makeSettings(nativeDir);

  await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: [],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  writeFileSync(join(projectDir, 'file.txt'), 'v2');

  const code = await runImportContext({
    profile,
    dryRun: false,
    force: true,
    include: [],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  assert.equal(
    readFileSync(join(targetDir, 'projects', 'force-project', 'file.txt'), 'utf8'),
    'v2',
  );
});

test('runImportContext --all includes only safe categories', async () => {
  const { nativeDir, profile } = setupProfile('all');
  const projectDir = makeProject('all-project', nativeDir);
  writeFileSync(join(projectDir, 'a.jsonl'), '{"type":"user"}\n');
  makeSettings(nativeDir);
  mkdirSync(join(nativeDir, 'agents'), { recursive: true });
  writeFileSync(join(nativeDir, 'agents', 'agent.json'), '{"name":"a"}');

  const code = await runImportContext({
    profile,
    dryRun: true,
    force: false,
    include: [],
    exclude: [],
    includeRisky: [],
    all: true,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
});

test('runImportContext --all copies skills and commands when present', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('all-copy');
  mkdirSync(join(nativeDir, 'skills'), { recursive: true });
  mkdirSync(join(nativeDir, 'commands'), { recursive: true });
  writeFileSync(join(nativeDir, 'skills', 'skill.md'), '# skill\n');
  writeFileSync(join(nativeDir, 'commands', 'cmd.md'), '# command\n');

  const code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: [],
    exclude: [],
    includeRisky: [],
    all: true,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  assert.equal(readFileSync(join(targetDir, 'skills', 'skill.md'), 'utf8'), '# skill\n');
  assert.equal(readFileSync(join(targetDir, 'commands', 'cmd.md'), 'utf8'), '# command\n');
});

test('runImportContext plain --include mcp errors and suggests --include-risky', async () => {
  const { nativeDir, profile } = setupProfile('mcp-error');
  const code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: ['mcp' as importContextMod.SafeCategory],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });
  assert.equal(code, 1);
});

test('runImportContext --include-risky mcp is accepted', async () => {
  const { nativeDir, profile } = setupProfile('risky-mcp');
  mkdirSync(join(nativeDir, 'mcp'), { recursive: true });
  writeFileSync(join(nativeDir, 'mcp', 'servers.json'), '{"servers":[]}');

  const code = await runImportContext({
    profile,
    dryRun: true,
    force: false,
    include: [],
    exclude: [],
    includeRisky: ['mcp'],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
});

test('runImportContext --include-risky settings-raw is accepted', async () => {
  const { nativeDir, profile } = setupProfile('risky-raw');
  makeSettings(nativeDir, { env: { SECRET: 'x' } });

  const code = await runImportContext({
    profile,
    dryRun: true,
    force: false,
    include: [],
    exclude: [],
    includeRisky: ['settings-raw'],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
});

test('runImportContext reports missing risky sources without failing dry-run', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('risky-missing');

  const code = await runImportContext({
    profile,
    dryRun: true,
    force: false,
    include: [],
    exclude: ['projects', 'settings-safe', 'agents'],
    includeRisky: ['settings-raw', 'mcp', 'hooks', 'plugins'],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  assert.equal(existsSync(targetDir), false);
});

test('runImportContext unknown category errors clearly', async () => {
  const { nativeDir, profile } = setupProfile('unknown');
  const code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: ['unknown' as importContextMod.SafeCategory],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });
  assert.equal(code, 1);
});

test('runImportContext rejects unknown risky and exclude categories', async () => {
  const { nativeDir, profile } = setupProfile('bad-categories');

  let code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: [],
    exclude: [],
    includeRisky: ['unknown-risky' as importContextMod.RiskyCategory],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });
  assert.equal(code, 1);

  code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: [],
    exclude: ['unknown-safe' as importContextMod.SafeCategory],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });
  assert.equal(code, 1);
});

test('runImportContext skips invalid safe settings JSON', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('bad-settings-json');
  writeFileSync(join(nativeDir, 'settings.json'), '{bad json');

  const code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: ['settings-safe'],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  assert.equal(existsSync(join(targetDir, 'settings.json')), false);
});

test('runImportContext top-level project symlinks are skipped in dry-run plan', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('top-symlink');
  const projectsDir = join(nativeDir, 'projects');
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(join(nativeDir, 'real-project'), { recursive: true });
  symlinkSync(join(nativeDir, 'real-project'), join(projectsDir, 'linked-project'));

  const code = await runImportContext({
    profile,
    dryRun: true,
    force: false,
    include: ['projects'],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  assert.equal(existsSync(join(targetDir, 'projects')), false);
});

test('runImportContext copies nested project directories', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('nested');
  const projectDir = makeProject('nested-project', nativeDir);
  const nestedDir = join(projectDir, 'nested', 'deeper');
  mkdirSync(nestedDir, { recursive: true });
  writeFileSync(join(nestedDir, 'note.txt'), 'nested note');

  const code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: ['projects'],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  assert.equal(
    readFileSync(join(targetDir, 'projects', 'nested-project', 'nested', 'deeper', 'note.txt'), 'utf8'),
    'nested note',
  );
});

test('runImportContext dry-run returns non-zero for conflicts', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('dry-conflict');
  const projectDir = makeProject('dry-conflict-project', nativeDir);
  writeFileSync(join(projectDir, 'file.txt'), 'v1');

  assert.equal(
    await runImportContext({
      profile,
      dryRun: false,
      force: false,
      include: ['projects'],
      exclude: [],
      includeRisky: [],
      all: false,
      sanitizeHistory: false,
      nativeClaudeDir: nativeDir,
    }),
    0,
  );
  writeFileSync(join(projectDir, 'file.txt'), 'v2');

  const code = await runImportContext({
    profile,
    dryRun: true,
    force: false,
    include: ['projects'],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 1);
  assert.equal(
    readFileSync(join(targetDir, 'projects', 'dry-conflict-project', 'file.txt'), 'utf8'),
    'v1',
  );
});

test('runImportContext imports risky file and directory categories', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('risky-all');
  writeFileSync(join(nativeDir, 'mcp.json'), '{"servers":[]}');
  mkdirSync(join(nativeDir, 'mcp'), { recursive: true });
  writeFileSync(join(nativeDir, 'mcp', 'local.json'), '{}');
  mkdirSync(join(nativeDir, 'hooks'), { recursive: true });
  writeFileSync(join(nativeDir, 'hooks', 'pre.json'), '{}');
  writeFileSync(join(nativeDir, 'hooks.json'), '{"hooks":[]}');
  mkdirSync(join(nativeDir, 'plugins', 'demo'), { recursive: true });
  writeFileSync(join(nativeDir, 'plugins', 'demo', 'plugin.json'), '{}');

  const code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: [],
    exclude: [],
    includeRisky: ['mcp', 'hooks', 'plugins'],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  assert.equal(existsSync(join(targetDir, 'mcp.json')), true);
  assert.equal(existsSync(join(targetDir, 'mcp', 'local.json')), true);
  assert.equal(existsSync(join(targetDir, 'hooks.json')), true);
  assert.equal(existsSync(join(targetDir, 'hooks', 'pre.json')), true);
  assert.equal(existsSync(join(targetDir, 'plugins', 'demo', 'plugin.json')), true);
});

test('runImportContext settings-raw overrides settings-safe target selection', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('settings-raw-wins');
  makeSettings(nativeDir, { env: { SECRET: 'x' } });

  const code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: [],
    exclude: [],
    includeRisky: ['settings-raw'],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  const settings = JSON.parse(readFileSync(join(targetDir, 'settings.json'), 'utf8'));
  assert.deepEqual(settings.env, { SECRET: 'x' });
});

test('runImportContext skips symlinks instead of following', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('symlink');
  const projectDir = makeProject('symlink-project', nativeDir);
  writeFileSync(join(projectDir, 'real.txt'), 'real');
  symlinkSync(
    join(projectDir, 'real.txt'),
    join(projectDir, 'link.txt'),
  );

  const code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: [],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  assert.equal(
    existsSync(join(targetDir, 'projects', 'symlink-project', 'real.txt')),
    true,
  );
  assert.equal(
    existsSync(join(targetDir, 'projects', 'symlink-project', 'link.txt')),
    false,
  );
});

test('runImportContext skips top-level category symlinks', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('cat-symlink');
  const realDir = join(nativeDir, 'real-skills');
  mkdirSync(realDir, { recursive: true });
  writeFileSync(join(realDir, 'a.md'), 'a');
  symlinkSync(realDir, join(nativeDir, 'skills'));

  const code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: [],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  assert.equal(existsSync(join(targetDir, 'skills')), false);
});

test('runImportContext copies missing files into existing target directories', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('incremental');
  const srcDir = join(nativeDir, 'agents');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, 'a.json'), '{"name":"a"}');

  // First sync
  await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: ['agents'],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(existsSync(join(targetDir, 'agents', 'a.json')), true);

  // Add a new file on native side
  writeFileSync(join(srcDir, 'b.json'), '{"name":"b"}');

  // Second sync without force — should still copy the new file
  const code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: ['agents'],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  assert.equal(existsSync(join(targetDir, 'agents', 'b.json')), true);
  assert.equal(readFileSync(join(targetDir, 'agents', 'a.json'), 'utf8'), '{"name":"a"}');
});

test('runImportContext --sanitize-history only affects jsonl transcripts', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('sanitize');
  const projectDir = makeProject('sanitize-project', nativeDir);
  writeFileSync(
    join(projectDir, 'session.jsonl'),
    JSON.stringify({
      uuid: 'a1',
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'internal' }],
      },
    }) + '\n',
  );
  writeFileSync(join(projectDir, 'note.txt'), 'plain');
  makeSettings(nativeDir);

  const code = await runImportContext({
    profile,
    dryRun: false,
    force: false,
    include: [],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: true,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(code, 0);
  const jsonl = readFileSync(
    join(targetDir, 'projects', 'sanitize-project', 'session.jsonl'),
    'utf8',
  );
  assert.doesNotMatch(jsonl, /"type":"thinking"/);
  assert.equal(
    readFileSync(join(targetDir, 'projects', 'sanitize-project', 'note.txt'), 'utf8'),
    'plain',
  );
});

test('runImportContext does not delete unrelated target categories', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('keep');
  const projectDir = makeProject('keep-project', nativeDir);
  writeFileSync(join(projectDir, 'a.txt'), 'a');
  makeSettings(nativeDir);

  await runImportContext({
    profile,
    dryRun: false,
    force: true,
    include: [],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  writeFileSync(join(projectDir, 'b.txt'), 'b');
  await runImportContext({
    profile,
    dryRun: false,
    force: true,
    include: ['projects'],
    exclude: [],
    includeRisky: [],
    all: false,
    sanitizeHistory: false,
    nativeClaudeDir: nativeDir,
  });

  assert.equal(
    existsSync(join(targetDir, 'settings.json')),
    true,
    'settings should remain when not selected',
  );
});

test('syncProfileContext imports default safe context without throwing', async () => {
  const { nativeDir, profile, targetDir } = setupProfile('sync');
  const projectDir = makeProject('sync-project', nativeDir);
  writeFileSync(join(projectDir, 'session.jsonl'), '{"type":"user"}\n');
  makeSettings(nativeDir);

  await importContextMod.syncProfileContext(profile, { nativeClaudeDir: nativeDir });

  assert.equal(
    existsSync(join(targetDir, 'projects', 'sync-project', 'session.jsonl')),
    true,
  );
  assert.equal(existsSync(join(targetDir, 'settings.json')), true);
});

test('CLI import-context with missing profile errors', () => {
  const result = spawnSync(
    process.execPath,
    [cliPath, 'import-context', 'missing'],
    {
      env: { ...process.env, CC_USE_DIR: process.env.CC_USE_DIR },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not found/);
});

test('CLI import-context --dry-run does not write', () => {
  const fixture = makeCliFixture('cli-dryrun');
  const result = spawnSync(
    process.execPath,
    [cliPath, 'import-context', 'deepseek', '--dry-run'],
    {
      cwd: fixture.cwd,
      env: { ...process.env, CC_USE_DIR: fixture.ccUseDir, HOME: fixture.home, USERPROFILE: fixture.home },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Will copy:/);
  assert.equal(
    existsSync(join(fixture.ccUseDir, 'sessions', 'deepseek', 'projects')),
    false,
  );
});

test('CLI import-context --all selects safe categories only', () => {
  const fixture = makeCliFixture('cli-all');
  mkdirSync(join(fixture.home, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(fixture.home, '.claude', 'agents', 'a.json'), '{}');

  const result = spawnSync(
    process.execPath,
    [cliPath, 'import-context', 'deepseek', '--all', '--dry-run'],
    {
      cwd: fixture.cwd,
      env: { ...process.env, CC_USE_DIR: fixture.ccUseDir, HOME: fixture.home, USERPROFILE: fixture.home },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /projects/);
  assert.doesNotMatch(result.stdout, /settings-raw/);
  assert.doesNotMatch(result.stdout, /mcp/);
  assert.doesNotMatch(result.stdout, /hooks/);
  assert.doesNotMatch(result.stdout, /plugins/);
});

test('CLI import-context --include mcp errors', () => {
  const fixture = makeCliFixture('cli-include-mcp');
  const result = spawnSync(
    process.execPath,
    [cliPath, 'import-context', 'deepseek', '--include', 'mcp'],
    {
      cwd: fixture.cwd,
      env: { ...process.env, CC_USE_DIR: fixture.ccUseDir, HOME: fixture.home, USERPROFILE: fixture.home },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--include-risky/i);
});

test('CLI import-context --include-risky mcp works', () => {
  const fixture = makeCliFixture('cli-risky-mcp');
  mkdirSync(join(fixture.home, '.claude', 'mcp'), { recursive: true });
  writeFileSync(join(fixture.home, '.claude', 'mcp', 'config.json'), '{}');

  const result = spawnSync(
    process.execPath,
    [cliPath, 'import-context', 'deepseek', '--include-risky', 'mcp', '--dry-run'],
    {
      cwd: fixture.cwd,
      env: { ...process.env, CC_USE_DIR: fixture.ccUseDir, HOME: fixture.home, USERPROFILE: fixture.home },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /mcp/);
});

test('CLI import-context uses default profile when omitted', () => {
  const fixture = makeCliFixture('cli-default-profile');
  writeFileSync(
    join(fixture.ccUseDir, 'config.json'),
    JSON.stringify({ default: 'deepseek' }),
  );

  const result = spawnSync(
    process.execPath,
    [cliPath, 'import-context', '--dry-run'],
    {
      cwd: fixture.cwd,
      env: { ...process.env, CC_USE_DIR: fixture.ccUseDir, HOME: fixture.home, USERPROFILE: fixture.home },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Will copy:/);
});

test('CLI import-context without profile and no default errors', () => {
  const fixture = makeCliFixture('cli-no-default');
  const result = spawnSync(
    process.execPath,
    [cliPath, 'import-context'],
    {
      cwd: fixture.cwd,
      env: { ...process.env, CC_USE_DIR: fixture.ccUseDir, HOME: fixture.home, USERPROFILE: fixture.home },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /profile name required/);
});

test('CLI import-history remains compatible', () => {
  const fixture = makeCliFixture('cli-history-compat');
  const projectDir = join(fixture.home, '.claude', 'projects', fixture.projectFolder);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, 'session.jsonl'),
    JSON.stringify({ type: 'user', message: { content: 'hello' } }) + '\n',
  );

  const result = spawnSync(
    process.execPath,
    [cliPath, 'import-history', 'deepseek'],
    {
      cwd: fixture.cwd,
      env: { ...process.env, CC_USE_DIR: fixture.ccUseDir, HOME: fixture.home, USERPROFILE: fixture.home },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    existsSync(join(fixture.ccUseDir, 'sessions', 'deepseek', 'projects', fixture.projectFolder, 'session.jsonl')),
    true,
  );
});

function makeCliFixture(name: string): {
  home: string;
  ccUseDir: string;
  cwd: string;
  projectFolder: string;
} {
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
    join(home, '.claude', 'settings.json'),
    JSON.stringify({ theme: 'dark' }),
  );

  return { home, ccUseDir, cwd: realCwd, projectFolder };
}

function encodeCwdToProjectFolder(cwd: string): string {
  return cwd.replace(/[\\/:]/g, '-');
}
