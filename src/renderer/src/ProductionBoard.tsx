import { useState, type ReactElement } from 'react';

import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import {
  addCharacterReference,
  assignStoryboardReference,
  buildApprovedProductionAssemblyPlan,
  clearStoryboardReference,
  productionShotRows,
  removeCharacterReference,
  type ProductionMutationResult
} from '../../shared/productionWorkflow';
import type { MediaAsset } from '../../shared/timelineTypes';
import { Button, StatusCard } from './ui';

const STATE_LABELS = {
  not_started: 'Not started', generating: 'Generating', needs_import: 'Needs import',
  needs_review: 'Needs review', approved: 'Approved', failed: 'Failed'
} as const;

export function ProductionBoard({ document, assets, busy, onSave, onOpenShot, onAssemble }: {
  readonly document: AiProjectDocument;
  readonly assets: readonly MediaAsset[];
  readonly busy: boolean;
  readonly onSave: (document: AiProjectDocument) => Promise<boolean>;
  readonly onOpenShot: (shotId: string) => Promise<void>;
  readonly onAssemble: () => boolean;
}): ReactElement | null {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ readonly tone: 'neutral' | 'success' | 'warning' | 'danger'; readonly text: string } | null>(null);
  const rows = productionShotRows(document);
  const activeCharacterIds = new Set(rows.flatMap((row) => row.characterIds));
  const activeCharacters = document.characters.filter((character) => activeCharacterIds.has(character.id));
  const images = assets.filter((asset) => asset.kind === 'image');
  const imageById = new Map(images.map((asset) => [asset.id, asset]));
  const referenceById = new Map(document.referenceAssets.map((entry) => [entry.id, entry]));
  const assembly = buildApprovedProductionAssemblyPlan(document, assets.map((asset) => ({
    id: asset.id, kind: asset.kind, durationMs: asset.metadata?.durationMs ?? null
  })));
  if (rows.length === 0) return null;

  const persist = async (result: ProductionMutationResult, success: string): Promise<void> => {
    if (!result.ok) {
      setMessage({ tone: 'warning', text: result.reason });
      return;
    }
    setSaving(true);
    try {
      const saved = await onSave(result.document);
      setMessage(saved
        ? { tone: 'success', text: success }
        : { tone: 'danger', text: 'The production mapping could not be saved. No provider job was started.' });
    } catch (error) {
      setMessage({
        tone: 'danger',
        text: `The production mapping could not be saved: ${error instanceof Error ? error.message : 'Unknown error'}. No provider job was started.`
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="production-board" aria-labelledby="production-board-title">
      <header className="production-board__header">
        <div>
          <h3 id="production-board-title">Storyboard production board</h3>
          <p>Map reviewed project images, then open and generate one shot at a time. This board never starts a provider job. Current provider modes send either the storyboard first frame or the character-reference set, not both.</p>
        </div>
        <StatusCard tone={assembly.ok ? 'success' : 'neutral'}>{rows.filter((row) => row.state === 'approved').length}/{rows.length} shots approved</StatusCard>
      </header>

      <div className="production-board__characters">
        <h4>Character reference library</h4>
        {activeCharacters.length === 0 && <span>This Writer version has no named characters.</span>}
        {activeCharacters.map((character) => {
          const assigned = character.referenceAssetIds.map((id) => ({ id, reference: referenceById.get(id) })).filter((entry) => entry.reference?.role === 'character');
          return <div className="production-board__character" key={character.id}>
            <strong>{character.name}</strong>
            <span>{character.invariantDescription}</span>
            <div className="production-board__reference-list">
              {assigned.map(({ id, reference }) => <span className="production-board__reference" key={id}>
                {imageById.get(reference!.assetId)?.displayName ?? reference!.label}
                <button type="button" disabled={busy || saving} aria-label={`Remove ${reference!.label} from ${character.name}`}
                  onClick={() => void persist(removeCharacterReference(document, character.id, id), `Removed a reference from ${character.name}.`)}>×</button>
              </span>)}
              <select aria-label={`Add image reference for ${character.name}`} disabled={busy || saving || assigned.length >= 3 || images.length === 0} value=""
                onChange={(event) => {
                  const asset = imageById.get(event.target.value);
                  if (asset === undefined) return;
                  void persist(addCharacterReference(document, {
                    characterId: character.id, assetId: asset.id,
                    referenceId: `character-reference-${crypto.randomUUID()}`,
                    label: `${character.name} · ${asset.displayName}`
                  }), `Assigned ${asset.displayName} to ${character.name}.`);
                }}>
                <option value="">{images.length === 0 ? 'Import images in Editing first' : 'Add project image…'}</option>
                {images.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}
              </select>
            </div>
          </div>;
        })}
      </div>

      <ol className="production-board__shots">
        {rows.map((row, index) => <li className="production-board__shot" key={row.shotId}>
          <div className="production-board__shot-heading">
            <span className="production-board__number">{String(index + 1).padStart(2, '0')}</span>
            <div><strong>{row.label}</strong><span>{row.sceneTitle} · {(row.durationMs / 1_000).toFixed(1)}s · {row.candidateCount} candidate(s) · {row.characterReferenceIds.length} character reference(s)</span></div>
            <span className={`production-board__state production-board__state--${row.state}`}>{STATE_LABELS[row.state]}</span>
          </div>
          <label className="studio-field">
            <span className="studio-field__label">Storyboard / first frame</span>
            <select disabled={busy || saving || images.length === 0} value={row.storyboardReference?.assetId ?? ''} onChange={(event) => {
              const asset = imageById.get(event.target.value);
              void persist(asset === undefined
                ? clearStoryboardReference(document, row.shotId)
                : assignStoryboardReference(document, {
                  shotId: row.shotId, assetId: asset.id,
                  referenceId: `storyboard-reference-${crypto.randomUUID()}`,
                  label: `Storyboard · ${row.label} · ${asset.displayName}`
                }), asset === undefined ? `Cleared the storyboard image for ${row.label}.` : `Mapped ${asset.displayName} to ${row.label}.`);
            }}>
              <option value="">{images.length === 0 ? 'Import storyboard images in Editing first' : 'No storyboard image'}</option>
              {images.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}
            </select>
          </label>
          <Button variant="ghost" disabled={busy || saving} onClick={() => void onOpenShot(row.shotId)}>Open shot for generation</Button>
        </li>)}
      </ol>

      {message !== null && <StatusCard tone={message.tone}>{message.text}</StatusCard>}
      {!assembly.ok && <StatusCard tone="neutral">Assembly blocked: {assembly.reason}</StatusCard>}
      <div className="production-board__actions">
        <Button variant="primary" disabled={busy || saving || !assembly.ok} onClick={() => {
          const assembled = onAssemble();
          setMessage({ tone: assembled ? 'success' : 'warning', text: assembled
            ? `Placed ${rows.length} approved shots on the timeline in Writer order. Save and review the cut before export.`
            : 'The cut was not assembled. Check the Editing status for the exact conflict.' });
        }}>Assemble approved shots on timeline</Button>
        <span>No generation, replacement, or export happens automatically.</span>
      </div>
    </section>
  );
}
