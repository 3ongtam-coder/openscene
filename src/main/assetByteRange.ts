export type AssetByteRange = {
  readonly start: number;
  readonly end: number;
  readonly length: number;
};

export type AssetByteRangeResult =
  | { readonly kind: 'full' }
  | { readonly kind: 'partial'; readonly range: AssetByteRange }
  | { readonly kind: 'invalid' };

function parseSafeInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseAssetByteRange(rangeHeader: string | null, fileSize: number): AssetByteRangeResult {
  if (rangeHeader === null) {
    return { kind: 'full' };
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (match === null || fileSize === 0) {
    return { kind: 'invalid' };
  }
  const first = match[1];
  const last = match[2];
  if (first === undefined || last === undefined || (first.length === 0 && last.length === 0)) {
    return { kind: 'invalid' };
  }
  if (first.length === 0) {
    const suffixLength = parseSafeInteger(last);
    if (suffixLength === null || suffixLength === 0) {
      return { kind: 'invalid' };
    }
    const start = Math.max(fileSize - suffixLength, 0);
    return { kind: 'partial', range: { start, end: fileSize - 1, length: fileSize - start } };
  }
  const start = parseSafeInteger(first);
  const requestedEnd = last.length === 0 ? fileSize - 1 : parseSafeInteger(last);
  if (start === null || requestedEnd === null || start >= fileSize || requestedEnd < start) {
    return { kind: 'invalid' };
  }
  const end = Math.min(requestedEnd, fileSize - 1);
  return { kind: 'partial', range: { start, end, length: end - start + 1 } };
}
