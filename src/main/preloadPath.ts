import { join } from 'node:path';

export function resolvePreloadScriptPath(mainOutputDirectory: string): string {
  return join(mainOutputDirectory, '../preload/index.cjs');
}
