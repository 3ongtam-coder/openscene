import { ProjectStoreError } from './projectStoreSupport';

const GIBIBYTE = 1_024 * 1_024 * 1_024;

export type AssetImportLimits = {
  readonly maximumSelectedFileCount: number;
  readonly maximumFileBytes: number;
  readonly maximumRequestBytes: number;
  readonly maximumProjectBytes: number;
};

export const DEFAULT_ASSET_IMPORT_LIMITS: AssetImportLimits = {
  maximumSelectedFileCount: 100,
  maximumFileBytes: 2 * GIBIBYTE,
  maximumRequestBytes: 4 * GIBIBYTE,
  maximumProjectBytes: 20 * GIBIBYTE
};

export class AssetImportValidationError extends ProjectStoreError {
}

export function assertAssetSelectionCount(selectedFileCount: number, limits: AssetImportLimits): void {
  if (!Number.isSafeInteger(selectedFileCount) || selectedFileCount < 1) {
    throw new AssetImportValidationError('At least one media file must be selected.');
  }
  if (selectedFileCount > limits.maximumSelectedFileCount) {
    throw new AssetImportValidationError(
      `A maximum of ${limits.maximumSelectedFileCount} media files can be imported at once.`
    );
  }
}

export function assertAssetImportQuota(
  input: { readonly selectedFileBytes: readonly number[]; readonly existingProjectBytes: number },
  limits: AssetImportLimits
): void {
  assertAssetSelectionCount(input.selectedFileBytes.length, limits);
  if (input.selectedFileBytes.some((bytes) => !Number.isSafeInteger(bytes) || bytes < 0)) {
    throw new AssetImportValidationError('Selected media size metadata is invalid.');
  }
  const oversizedFile = input.selectedFileBytes.find((bytes) => bytes > limits.maximumFileBytes);
  if (oversizedFile !== undefined) {
    throw new AssetImportValidationError(`A selected media file exceeds the ${limits.maximumFileBytes} byte limit.`);
  }
  const requestBytes = input.selectedFileBytes.reduce((total, bytes) => total + bytes, 0);
  if (!Number.isSafeInteger(requestBytes) || requestBytes > limits.maximumRequestBytes) {
    throw new AssetImportValidationError(`Selected media exceeds the ${limits.maximumRequestBytes} byte request limit.`);
  }
  const projectBytes = input.existingProjectBytes + requestBytes;
  if (!Number.isSafeInteger(projectBytes) || projectBytes > limits.maximumProjectBytes) {
    throw new AssetImportValidationError(
      `The project asset library would exceed the ${limits.maximumProjectBytes} byte limit.`
    );
  }
}
