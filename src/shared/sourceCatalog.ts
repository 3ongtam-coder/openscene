import type { CaptureSource, SelectSourceInput } from './models';

export interface RawCaptureSource {
  id: string;
  name: string;
  thumbnailDataUrl?: string;
  displayId?: string;
}

const MAX_NAME_LENGTH = 120;
const MAX_DATA_URL_LENGTH = 1_500_000;

export function normalizeVisibleText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

export function deriveAppName(sourceName: string): string {
  const cleanName = normalizeVisibleText(sourceName);
  const separatorIndex = cleanName.indexOf(' - ');
  if (separatorIndex > 0) {
    return cleanName.slice(0, separatorIndex);
  }

  const emDashIndex = cleanName.indexOf(' — ');
  if (emDashIndex > 0) {
    return cleanName.slice(0, emDashIndex);
  }

  return cleanName || 'Unknown Window';
}

export function sanitizeCaptureSource(rawSource: RawCaptureSource, generation: number): CaptureSource | null {
  const id = normalizeVisibleText(rawSource.id);
  const name = normalizeVisibleText(rawSource.name);

  if (id.length === 0 || name.length === 0 || !Number.isInteger(generation) || generation < 1) {
    return null;
  }

  const source: CaptureSource = {
    id,
    name,
    appName: deriveAppName(name),
    generation
  };

  if (typeof rawSource.displayId === 'string' && rawSource.displayId.trim().length > 0) {
    source.displayId = normalizeVisibleText(rawSource.displayId);
  }

  if (
    typeof rawSource.thumbnailDataUrl === 'string' &&
    rawSource.thumbnailDataUrl.startsWith('data:image/') &&
    rawSource.thumbnailDataUrl.length <= MAX_DATA_URL_LENGTH
  ) {
    source.thumbnailDataUrl = rawSource.thumbnailDataUrl;
  }

  return source;
}

export class SourceCatalog {
  private generation = 0;
  private readonly sources = new Map<string, CaptureSource>();
  private selectedSourceId: string | null = null;

  refresh(rawSources: RawCaptureSource[]): CaptureSource[] {
    this.generation += 1;
    this.sources.clear();
    this.selectedSourceId = null;

    const sanitizedSources: CaptureSource[] = [];
    for (const rawSource of rawSources) {
      const source = sanitizeCaptureSource(rawSource, this.generation);
      if (source !== null && !this.sources.has(source.id)) {
        this.sources.set(source.id, source);
        sanitizedSources.push(source);
      }
    }

    return sanitizedSources;
  }

  select(input: SelectSourceInput): CaptureSource | null {
    if (input.generation !== this.generation) {
      return null;
    }

    const source = this.sources.get(input.sourceId);
    if (source === undefined) {
      return null;
    }

    this.selectedSourceId = source.id;
    return source;
  }

  getSelected(): CaptureSource | null {
    if (this.selectedSourceId === null) {
      return null;
    }

    return this.sources.get(this.selectedSourceId) ?? null;
  }

  clearSelected(): void {
    this.selectedSourceId = null;
  }

  hasCurrentSource(input: SelectSourceInput): boolean {
    return input.generation === this.generation && this.sources.has(input.sourceId);
  }
}
