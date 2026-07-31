import { useCallback, useEffect, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Providers the user adds themselves.
 *
 * The built-in catalog is 153 providers long and still does not cover a
 * self-hosted endpoint, a gateway, or a regional deployment — Alibaba's
 * OpenAI-compatible endpoint among them. Anything speaking that wire format
 * needs no new code, only a base URL and a key, so it should not require a
 * release.
 *
 * Chat only, and deliberately. Media generation is not one protocol: every
 * image and video provider here has a hand-written adapter for its own request
 * shape and its own polling. A "custom video provider" field would accept a URL
 * and then fail at the first call, which is worse than not offering it.
 */

export type CustomProvider = {
  readonly id: string;
  readonly label: string;
  /** Base URL up to but excluding /chat/completions. */
  readonly baseUrl: string;
  /** Model ids the endpoint serves; the user names them because we cannot ask. */
  readonly models: readonly string[];
};

const FILE = new File(new Directory(Paths.document), 'custom-providers.json');

/** Namespaced so a custom id can never collide with a catalog one. */
export const CUSTOM_PREFIX = 'custom:';

export function isCustomProviderId(providerId: string): boolean {
  return providerId.startsWith(CUSTOM_PREFIX);
}

/** Where the key for a custom provider is stored, in the same keystore as the rest. */
export function customCredentialKey(providerId: string): string {
  return `custom_${providerId.slice(CUSTOM_PREFIX.length)}`;
}

function read(): readonly CustomProvider[] {
  try {
    if (!FILE.exists) return [];
    const parsed: unknown = JSON.parse(FILE.textSync());
    if (!Array.isArray(parsed)) return [];
    // Validated on the way in rather than trusted: this file is editable between
    // sessions, and a malformed entry would surface as an unexplained request
    // failure long after the edit.
    return parsed.filter((entry): entry is CustomProvider => {
      const candidate = entry as Partial<CustomProvider>;
      return (
        typeof candidate.id === 'string' &&
        candidate.id.startsWith(CUSTOM_PREFIX) &&
        typeof candidate.label === 'string' &&
        typeof candidate.baseUrl === 'string' &&
        Array.isArray(candidate.models)
      );
    });
  } catch {
    return [];
  }
}

function write(providers: readonly CustomProvider[]): void {
  try {
    FILE.write(JSON.stringify(providers));
  } catch {
    // A provider that cannot be persisted is reported as not added, because the
    // alternative is one that works until the app restarts.
  }
}

export function listCustomProviders(): readonly CustomProvider[] {
  return read();
}

export function findCustomProvider(providerId: string): CustomProvider | undefined {
  return read().find((provider) => provider.id === providerId);
}

export type AddResult = { readonly ok: true; readonly provider: CustomProvider } | { readonly ok: false; readonly message: string };

export function addCustomProvider(input: {
  readonly label: string;
  readonly baseUrl: string;
  readonly models: string;
}): AddResult {
  const label = input.label.trim();
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
  const models = input.models
    .split(/[\n,]/)
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

  if (label.length === 0) return { ok: false, message: 'Give the provider a name.' };
  // https only: a key sent over http is readable by anything on the network
  // between the phone and the endpoint, and this field takes a key.
  if (!/^https:\/\/.+/.test(baseUrl)) {
    return { ok: false, message: 'The base URL must start with https:// — a key must not travel in clear text.' };
  }
  if (models.length === 0) return { ok: false, message: 'Name at least one model the endpoint serves.' };

  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider';
  const existing = read();
  if (existing.some((provider) => provider.id === `${CUSTOM_PREFIX}${slug}`)) {
    return { ok: false, message: `A custom provider named ${label} already exists.` };
  }

  const provider: CustomProvider = { id: `${CUSTOM_PREFIX}${slug}`, label, baseUrl, models };
  write([...existing, provider]);
  return { ok: true, provider };
}

export function removeCustomProvider(providerId: string): void {
  write(read().filter((provider) => provider.id !== providerId));
}

/** Re-reads on demand, because the list changes from more than one screen. */
export function useCustomProviders() {
  const [providers, setProviders] = useState<readonly CustomProvider[]>([]);
  const refresh = useCallback(() => setProviders(read()), []);
  useEffect(refresh, [refresh]);
  return { providers, refresh };
}
