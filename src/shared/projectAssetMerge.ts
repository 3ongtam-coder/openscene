import type { MediaAsset } from './timelineTypes';

export function mergeImportedAssets(currentAssets: readonly MediaAsset[], importedAssets: readonly MediaAsset[]): readonly MediaAsset[] {
  if (importedAssets.length === 0) return currentAssets;
  const importedById = new Map(importedAssets.map((asset) => [asset.id, asset]));
  const mergedExistingAssets = currentAssets.map((asset) => importedById.get(asset.id) ?? asset);
  const existingAssetIds = new Set(currentAssets.map((asset) => asset.id));
  return [...mergedExistingAssets, ...importedAssets.filter((asset) => !existingAssetIds.has(asset.id))];
}
