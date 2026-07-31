import { getDomainModels, type AiDomain } from '@openvideo/shared/aiDomainModels';

import { PROVIDER_KEYS, readSlot } from './credentials';

/**
 * Which providers power a domain, and what connecting one buys.
 *
 * The Settings list used to be a flat run of every credential the app knows,
 * which answered "what keys exist" but never "what do I need for the thing I am
 * trying to do". Generation is chosen per domain — a video model, an image
 * model — so the providers are grouped the same way, and each says how many of
 * its models actually run here.
 */

export type MediaProvider = {
  readonly providerId: string;
  readonly slot: string;
  readonly label: string;
  readonly hint: string;
  /** Models this key makes usable right now. */
  readonly runnable: number;
  /** Models the catalog lists for it, ported or not. */
  readonly listed: number;
};

// Keyed by plain string: the catalog's provider ids are open-ended, and a
// lookup that only accepts the twelve we happen to hold keys for cannot answer
// "is this one connectable" for the rest.
const SLOT_BY_PROVIDER: ReadonlyMap<string, (typeof PROVIDER_KEYS)[number]> = new Map(
  PROVIDER_KEYS.map((entry) => [entry.providerId as string, entry])
);

export function providersForDomain(domain: AiDomain): readonly MediaProvider[] {
  const byProvider = new Map<string, { label: string; runnable: number; listed: number }>();
  for (const model of getDomainModels(domain)) {
    const current = byProvider.get(model.providerId) ?? { label: model.providerLabel, runnable: 0, listed: 0 };
    byProvider.set(model.providerId, {
      label: current.label,
      runnable: current.runnable + (model.available ? 1 : 0),
      listed: current.listed + 1
    });
  }

  return [...byProvider.entries()]
    .flatMap(([providerId, counts]) => {
      const credential = SLOT_BY_PROVIDER.get(providerId);
      // A provider with no credential slot cannot be connected from here; listing
      // it would offer a control that does nothing.
      if (credential === undefined) return [];
      return [{
        providerId,
        slot: credential.slot,
        label: counts.label,
        hint: credential.hint,
        runnable: counts.runnable,
        listed: counts.listed
      }];
    })
    // Providers you can actually use first: a list led by three greyed-out
    // engines reads as a broken app rather than a partial one.
    .sort((a, b) => b.runnable - a.runnable || a.label.localeCompare(b.label));
}

export function slotForProvider(providerId: string): string | undefined {
  return SLOT_BY_PROVIDER.get(providerId)?.slot;
}

/** Connection state keyed by provider id, which is what the pickers key on. */
export async function readProviderConnections(): Promise<Readonly<Record<string, boolean>>> {
  const entries = await Promise.all(
    PROVIDER_KEYS.map(async ({ providerId, slot }) => [providerId, (await readSlot(slot)) !== null] as const)
  );
  return Object.fromEntries(entries);
}

export function describeProvider(provider: MediaProvider): string {
  if (provider.runnable === 0) return `${provider.listed} models listed, none runnable yet`;
  return provider.runnable === provider.listed
    ? `${provider.runnable} model${provider.runnable === 1 ? '' : 's'}`
    : `${provider.runnable} of ${provider.listed} models run here`;
}
