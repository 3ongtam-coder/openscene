import { useCallback, useEffect, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Per-feature permission, in the shape the desktop agent uses: once, always, or
 * reject. Generation spends the user's own money, so each feature asks before
 * the first charge and remembers only what the user chose to have remembered.
 *
 * "Always" is stored per feature rather than globally. Allowing every future
 * image is a different decision from allowing every future video, and the two
 * do not cost remotely the same.
 */
export const SPEND_FEATURES = ['image-generation', 'video-generation', 'voice-generation'] as const;
export type SpendFeature = (typeof SPEND_FEATURES)[number];

export type Decision = 'once' | 'always' | 'reject';

const FILE = new File(new Directory(Paths.document), 'spend-permissions.json');

type Stored = Partial<Record<SpendFeature, 'always' | 'reject'>>;

function read(): Stored {
  try {
    return FILE.exists ? (JSON.parse(FILE.textSync()) as Stored) : {};
  } catch {
    return {};
  }
}

function write(next: Stored): void {
  try {
    FILE.write(JSON.stringify(next));
  } catch {
    // A permission that cannot be persisted degrades to asking every time,
    // which is the safe direction.
  }
}

export function useSpendPermissions() {
  const [standing, setStanding] = useState<Stored>({});
  useEffect(() => setStanding(read()), []);

  const remember = useCallback((feature: SpendFeature, decision: Decision) => {
    if (decision === 'once') return;
    const next = { ...read(), [feature]: decision };
    write(next);
    setStanding(next);
  }, []);

  const forget = useCallback((feature: SpendFeature) => {
    const next = { ...read() };
    delete next[feature];
    write(next);
    setStanding(next);
  }, []);

  return {
    standing,
    remember,
    forget,
    /** Null when the user has not decided; the caller must ask. */
    standingFor: (feature: SpendFeature): 'always' | 'reject' | null => standing[feature] ?? null
  };
}
