import { listProfiles, loadProfile, looksLikePlaceholder, type Profile } from './profile.js';
import { sessionDirFor } from './paths.js';

export interface DoctorOptions {
  profile: string;
  probe: boolean;
}

export type ProbeResult =
  | {
      status: 'ok';
      httpStatus: number;
      statusText: string;
      bodyText: string;
      bodyJson: unknown;
    }
  | {
      status: 'rejected';
      httpStatus: number;
      statusText: string;
      bodyText: string;
      bodyJson: unknown;
      errorType?: string;
      errorMessage?: string;
    }
  | {
      status: 'failed';
      errorType: string;
      errorMessage: string;
      httpStatus?: number;
      statusText?: string;
      bodyText?: string;
    };

export async function probeMessagesApi(profile: Profile): Promise<ProbeResult> {
  const token = profile.env.ANTHROPIC_AUTH_TOKEN ?? '';
  const model = profile.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';
  const url = buildMessagesUrl(profile.env.ANTHROPIC_BASE_URL!);

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
    return {
      status: 'failed',
      errorType: 'network_error',
      errorMessage: (e as Error).message,
    };
  }

  let bodyText = '';
  try {
    bodyText = await resp.text();
  } catch (e) {
    return {
      status: 'failed',
      errorType: 'read_error',
      errorMessage: (e as Error).message,
      httpStatus: resp.status,
      statusText: resp.statusText,
    };
  }

  let bodyJson: unknown;
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    return {
      status: 'failed',
      errorType: 'invalid_json',
      errorMessage: 'response body is not valid JSON',
      httpStatus: resp.status,
      statusText: resp.statusText,
      bodyText,
    };
  }

  if (resp.ok && isMessageShape(bodyJson)) {
    return {
      status: 'ok',
      httpStatus: resp.status,
      statusText: resp.statusText,
      bodyText,
      bodyJson,
    };
  }

  if (bodyJson === undefined || resp.ok) {
    return {
      status: 'failed',
      errorType: 'invalid_response',
      errorMessage: 'response body is not an Anthropic Messages response',
      httpStatus: resp.status,
      statusText: resp.statusText,
      bodyText,
    };
  }

  const err = describeAnthropicError(bodyJson);
  return {
    status: 'rejected',
    httpStatus: resp.status,
    statusText: resp.statusText,
    bodyText,
    bodyJson,
    errorType: err.type ?? `http_${resp.status}`,
    errorMessage: err.message ?? 'response body is not an Anthropic Messages response',
  };
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

  const model = profile.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';
  const url = buildMessagesUrl(profile.env.ANTHROPIC_BASE_URL!);
  process.stdout.write(`\nProbing ${url} (model: ${model})...\n`);

  const result = await probeMessagesApi(profile);
  if (result.status === 'failed') {
    process.stderr.write(`  FAIL: ${result.errorType}: ${result.errorMessage}\n`);
    return 1;
  }

  const summary = `HTTP ${result.httpStatus} ${result.statusText || ''}`.trim();
  if (result.status === 'ok') {
    process.stdout.write(`  OK: ${summary} (Anthropic Messages shape).\n`);
    return 0;
  }
  if (result.httpStatus === 401 || result.httpStatus === 403) {
    process.stderr.write(`  AUTH: ${summary}. Endpoint speaks Anthropic but key is rejected.\n`);
    if (typeof result.bodyText === 'string' && result.bodyText.length < 400) {
      process.stderr.write(`        body: ${result.bodyText.replace(/\s+/g, ' ').trim()}\n`);
    }
    return 1;
  }
  if (result.httpStatus === 404) {
    process.stderr.write(
      `  ENDPOINT: ${summary}. Wrong base_url or this provider doesn't expose /v1/messages.\n`,
    );
    return 1;
  }
  if (isAnthropicError(result.bodyJson)) {
    process.stderr.write(`  ERR: ${summary}. Anthropic-style error: ${describeError(result.bodyJson)}\n`);
    return 1;
  }
  process.stderr.write(
    `  UNKNOWN: ${summary}. Body does not look like Anthropic Messages API.\n`,
  );
  if (typeof result.bodyText === 'string' && result.bodyText.length < 400) {
    process.stderr.write(`           body: ${result.bodyText.replace(/\s+/g, ' ').trim()}\n`);
  }
  return 1;
}

export function buildMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/v1\/messages$/.test(trimmed)) return trimmed;
  if (/\/v1$/.test(trimmed)) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
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
  const err = describeAnthropicError(v);
  return `${err.type ?? 'unknown'}: ${err.message ?? ''}`;
}

function describeAnthropicError(v: unknown): { type?: string; message?: string } {
  const o = v as Record<string, any>;
  const err = o.error || {};
  return {
    type: typeof err.type === 'string' ? err.type : undefined,
    message: typeof err.message === 'string' ? err.message : undefined,
  };
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
