import { getAutoConfig, getDefaultProfile, type AutoConfig } from './config.js';
import { probeMessagesApi } from './doctor.js';
import { readBalance } from './balance.js';
import { findPlaceholders, loadProfile, profileExists } from './profile.js';
import {
  getCachedStatus,
  isFresh,
  saveStatus,
  type UsabilityDetails,
  type UsabilityReason,
  type UsabilityResult,
} from './status.js';

export async function selectAutoProfile(): Promise<string | number> {
  const auto = getAutoConfig();
  const candidates = resolveCandidates(auto);
  if (candidates.length === 0) {
    process.stderr.write(
      `cc-use auto: no auto candidates configured. Add auto.fallbackOrder in ~/.cc-use/config.json.\n`,
    );
    return 1;
  }

  const checked: UsabilityResult[] = [];
  for (const name of candidates) {
    const cached = getCachedStatus(name);
    if (cached && cached.usable && isFresh(cached, auto.cacheTtlSeconds) && profileExists(name)) {
      process.stderr.write(`cc-use auto: selected '${name}' (${cached.reason}, cached).\n`);
      return name;
    }

    const result = await checkUsability(name, auto);
    saveStatus(result);
    checked.push(result);
    if (result.usable) {
      process.stderr.write(`cc-use auto: selected '${name}' (${result.reason}).\n`);
      return name;
    }
  }

  process.stderr.write(`cc-use auto: no usable profile found.\n`);
  for (const result of checked) {
    process.stderr.write(`  ${result.profileName}: ${result.reason}\n`);
  }
  return 1;
}

export async function checkUsability(profileName: string, auto = getAutoConfig()): Promise<UsabilityResult> {
  const checkedAt = new Date().toISOString();
  const autoProfile = auto.profiles[profileName];
  if (!autoProfile) {
    return result(profileName, false, 'unknown', checkedAt);
  }

  if (!profileExists(profileName)) {
    return result(profileName, false, 'check_failed', checkedAt, {
      errorType: 'profile_not_found',
      errorMessage: `profile '${profileName}' not found`,
    });
  }

  let profile;
  try {
    profile = loadProfile(profileName);
  } catch (e) {
    return result(profileName, false, 'check_failed', checkedAt, {
      errorType: 'profile_load_failed',
      errorMessage: (e as Error).message,
    });
  }

  const placeholders = findPlaceholders(profile.env);
  if (placeholders.length > 0) {
    return result(profileName, false, 'check_failed', checkedAt, {
      errorType: 'profile_unfinished',
      errorMessage: `unfilled placeholders: ${placeholders.join(', ')}`,
    });
  }

  const check = autoProfile.check;
  if (!check) {
    return result(profileName, false, 'unknown', checkedAt);
  }

  if (check.kind === 'manual_availability') {
    return result(
      profileName,
      check.available,
      check.available ? 'manual_available' : 'manual_unavailable',
      checkedAt,
    );
  }

  if (check.kind === 'probe') {
    return await checkProbe(profileName, checkedAt, profile);
  }

  try {
    const balance = await readBalance(check.adapter, profile);
    const minBalance = autoProfile.minBalance ?? 0;
    const details = {
      balance: balance.balance,
      currency: balance.currency,
      minBalance,
      adapter: check.adapter,
    };
    return balance.balance >= minBalance
      ? result(profileName, true, 'balance_ok', checkedAt, details)
      : result(profileName, false, 'balance_below_threshold', checkedAt, details);
  } catch (e) {
    return result(profileName, false, 'check_failed', checkedAt, {
      adapter: check.adapter,
      errorType: 'balance_check_failed',
      errorMessage: (e as Error).message,
    });
  }
}

function resolveCandidates(auto: AutoConfig): string[] {
  const names: string[] = [];
  const def = getDefaultProfile();
  if (def) names.push(def);
  names.push(...auto.fallbackOrder);
  const seen = new Set<string>();
  return names.filter((name) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

async function checkProbe(
  profileName: string,
  checkedAt: string,
  profile: Parameters<typeof probeMessagesApi>[0],
): Promise<UsabilityResult> {
  const probe = await probeMessagesApi(profile);
  if (probe.status === 'ok') {
    return result(profileName, true, 'probe_ok', checkedAt, {
      httpStatus: probe.httpStatus,
    });
  }
  if (probe.status === 'rejected') {
    return result(profileName, false, 'probe_failed', checkedAt, {
      httpStatus: probe.httpStatus,
      errorType: probe.errorType,
      errorMessage: probe.errorMessage,
    });
  }
  return result(profileName, false, 'check_failed', checkedAt, {
    httpStatus: probe.httpStatus,
    errorType: probe.errorType,
    errorMessage: probe.errorMessage,
  });
}

function result(
  profileName: string,
  usable: boolean,
  reason: UsabilityReason,
  checkedAt: string,
  details?: UsabilityDetails,
): UsabilityResult {
  return details
    ? { profileName, usable, reason, checkedAt, details }
    : { profileName, usable, reason, checkedAt };
}
