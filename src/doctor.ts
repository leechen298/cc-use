import { listProfiles, loadProfile, looksLikePlaceholder } from './profile.js';
import { sessionDirFor } from './paths.js';

export interface DoctorOptions {
  profile: string;
  probe: boolean;
}

export async function runDoctor(opts: DoctorOptions): Promise<number> {
  let profile;
  try {
    profile = loadProfile(opts.profile);
  } catch (e) {
    process.stderr.write(`cc-use doctor: ${(e as Error).message}\n`);
    return 1;
  }

  process.stdout.write(`Profile: ${profile.name}\n`);
  process.stdout.write(`Source:  ${profile.source}\n`);
  process.stdout.write(`Session: ${sessionDirFor(profile.name)}\n`);
  process.stdout.write(`\nFields:\n`);
  for (const [k, v] of Object.entries(profile.env)) {
    const display = isSensitive(k) ? maskSecret(v) : v;
    process.stdout.write(`  ${k} = ${display}\n`);
  }

  let warnings = 0;
  const token = profile.env.ANTHROPIC_AUTH_TOKEN ?? '';
  if (looksLikePlaceholder(token)) {
    process.stderr.write(
      `\n  WARN: ANTHROPIC_AUTH_TOKEN looks like a placeholder. Run 'cc-use init ${profile.name} --force' to set a real key.\n`,
    );
    warnings++;
  }

  if (!opts.probe) {
    process.stdout.write(`\nSkipping live probe (--no-probe). Done.\n`);
    return warnings > 0 ? 0 : 0;
  }

  if (looksLikePlaceholder(token)) {
    process.stdout.write(`\nSkipping live probe because token is a placeholder.\n`);
    return 1;
  }

  const baseUrl = profile.env.ANTHROPIC_BASE_URL!.replace(/\/+$/, '');
  const model = profile.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';
  const url = `${baseUrl}/v1/messages`;
  process.stdout.write(`\nProbing ${url} (model: ${model})...\n`);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': token,
        authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
  } catch (e) {
    process.stderr.write(`  FAIL: network error: ${(e as Error).message}\n`);
    return 1;
  }

  let bodyText = '';
  try {
    bodyText = await resp.text();
  } catch {
    bodyText = '';
  }

  let bodyJson: unknown;
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    bodyJson = undefined;
  }

  const summary = `HTTP ${resp.status} ${resp.statusText || ''}`.trim();
  if (resp.ok && isMessageShape(bodyJson)) {
    process.stdout.write(`  OK: ${summary} (Anthropic Messages shape).\n`);
    return 0;
  }
  if (resp.status === 401 || resp.status === 403) {
    process.stderr.write(`  AUTH: ${summary}. Endpoint speaks Anthropic but key is rejected.\n`);
    if (typeof bodyText === 'string' && bodyText.length < 400) {
      process.stderr.write(`        body: ${bodyText.replace(/\s+/g, ' ').trim()}\n`);
    }
    return 1;
  }
  if (resp.status === 404) {
    process.stderr.write(
      `  ENDPOINT: ${summary}. Wrong base_url or this provider doesn't expose /v1/messages.\n`,
    );
    return 1;
  }
  if (isAnthropicError(bodyJson)) {
    process.stderr.write(`  ERR: ${summary}. Anthropic-style error: ${describeError(bodyJson)}\n`);
    return 1;
  }
  process.stderr.write(
    `  UNKNOWN: ${summary}. Body does not look like Anthropic Messages API.\n`,
  );
  if (typeof bodyText === 'string' && bodyText.length < 400) {
    process.stderr.write(`           body: ${bodyText.replace(/\s+/g, ' ').trim()}\n`);
  }
  return 1;
}

function isMessageShape(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.type === 'message' && Array.isArray(o.content);
}

function isAnthropicError(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.type === 'error' && typeof o.error === 'object';
}

function describeError(v: unknown): string {
  const o = v as Record<string, any>;
  const err = o.error || {};
  return `${err.type ?? 'unknown'}: ${err.message ?? ''}`;
}

function isSensitive(key: string): boolean {
  return key.includes('TOKEN') || key.includes('KEY') || key.includes('SECRET');
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '***';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

export async function runDoctorAll(opts: { probe: boolean }): Promise<number> {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    process.stderr.write(`cc-use doctor --all: no profiles configured. Run 'cc-use init' first.\n`);
    return 1;
  }
  let okCount = 0;
  let failCount = 0;
  for (const p of profiles) {
    process.stdout.write(`\n=== ${p.name} ===\n`);
    const code = await runDoctor({ profile: p.name, probe: opts.probe });
    if (code === 0) okCount++;
    else failCount++;
  }
  process.stdout.write(`\n--- Summary ---\n`);
  process.stdout.write(`  ${okCount} ok, ${failCount} failed (of ${profiles.length} profiles)\n`);
  return failCount > 0 ? 1 : 0;
}
