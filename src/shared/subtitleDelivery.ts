import { isAutomaticCaptionId } from './transcription';
import type { TimelineDocument, TimelineTitle } from './timelineTypes';
import { hasAllowedKeys, isPlainRecord } from './timelineValidationPrimitives';

export const SUBTITLE_SIDECAR_FORMATS = ['none', 'srt', 'vtt', 'ass'] as const;
export const SUBTITLE_DELIVERY_LIMITS = { cues: 5_000, charactersPerCue: 500, maximumTimeMs: 7_200_000 } as const;
export type SubtitleSidecarFormat = (typeof SUBTITLE_SIDECAR_FORMATS)[number];

export type SubtitleDelivery = {
  readonly burnAutomaticCaptions: boolean;
  readonly sidecarFormat: SubtitleSidecarFormat;
};

export const DEFAULT_SUBTITLE_DELIVERY: SubtitleDelivery = Object.freeze({
  burnAutomaticCaptions: true,
  sidecarFormat: 'none'
});

export function parseSubtitleDelivery(value: unknown): SubtitleDelivery | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['burnAutomaticCaptions', 'sidecarFormat']) ||
    typeof value.burnAutomaticCaptions !== 'boolean' ||
    typeof value.sidecarFormat !== 'string' || !(SUBTITLE_SIDECAR_FORMATS as readonly string[]).includes(value.sidecarFormat)) return null;
  return { burnAutomaticCaptions: value.burnAutomaticCaptions, sidecarFormat: value.sidecarFormat as SubtitleSidecarFormat };
}

export type SubtitleSidecar = {
  readonly format: Exclude<SubtitleSidecarFormat, 'none'>;
  readonly extension: 'srt' | 'vtt' | 'ass';
  readonly mimeType: 'application/x-subrip' | 'text/vtt' | 'text/x-ssa';
  readonly contents: string;
  readonly cueCount: number;
};

export function automaticCaptionTitles(timeline: TimelineDocument): readonly TimelineTitle[] {
  return (timeline.titles ?? [])
    .filter((title) => isAutomaticCaptionId(title.id))
    .slice()
    .sort((left, right) => left.timelineStartMs - right.timelineStartMs || left.timelineEndMs - right.timelineEndMs || left.id.localeCompare(right.id));
}

/** Manual titles always remain burn-in content; the option controls generated captions only. */
export function timelineForSubtitleDelivery(timeline: TimelineDocument, delivery: SubtitleDelivery): TimelineDocument {
  if (delivery.burnAutomaticCaptions) return timeline;
  const titles = (timeline.titles ?? []).filter((title) => !isAutomaticCaptionId(title.id));
  return { ...timeline, ...(titles.length === 0 ? { titles: [] } : { titles }) };
}

function clock(milliseconds: number, separator: ',' | '.'): string {
  const bounded = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(bounded / 3_600_000);
  const minutes = Math.floor((bounded % 3_600_000) / 60_000);
  const seconds = Math.floor((bounded % 60_000) / 1_000);
  const millis = bounded % 1_000;
  const core = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}${separator}${millis.toString().padStart(3, '0')}`;
  return `${hours.toString().padStart(2, '0')}:${core}`;
}

function assClock(centiseconds: number): string {
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const seconds = Math.floor((centiseconds % 6_000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${fraction.toString().padStart(2, '0')}`;
}

function srtText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
}

function vttText(text: string): string {
  // A cue-looking line can be parsed as syntax by some WebVTT readers.
  return srtText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/^WEBVTT$/gmu, 'WEBVTT\u00a0')
    .replace(/^NOTE(?:\s|$)/gmu, 'NOTE\u00a0');
}

function assText(text: string): string {
  return srtText(text)
    .replace(/\\/g, '\u29f5')
    // ASS treats braces as inline override tags. Keep the visible glyph while
    // making user text inert, and use escapes so source encoding cannot alter it.
    .replace(/[{}]/g, (value) => value === '{' ? '\uff5b' : '\uff5d')
    .replace(/\n/g, '\\N');
}

export function createSubtitleSidecar(timeline: TimelineDocument, format: Exclude<SubtitleSidecarFormat, 'none'>): SubtitleSidecar {
  const cues = automaticCaptionTitles(timeline);
  if (cues.length === 0) throw new Error('Apply approved automatic captions to the timeline before exporting a subtitle sidecar.');
  if (cues.length > SUBTITLE_DELIVERY_LIMITS.cues || cues.some((cue) =>
    cue.text.length === 0 || cue.text.length > SUBTITLE_DELIVERY_LIMITS.charactersPerCue ||
    !Number.isSafeInteger(cue.timelineStartMs) || !Number.isSafeInteger(cue.timelineEndMs) ||
    cue.timelineStartMs < 0 || cue.timelineEndMs <= cue.timelineStartMs || cue.timelineEndMs > SUBTITLE_DELIVERY_LIMITS.maximumTimeMs
  )) throw new Error('Automatic captions exceed the bounded subtitle delivery contract. Review their text and timing before export.');
  if (format === 'srt') {
    return {
      format, extension: 'srt', mimeType: 'application/x-subrip', cueCount: cues.length,
      contents: `${cues.map((cue, index) => `${index + 1}\n${clock(cue.timelineStartMs, ',')} --> ${clock(cue.timelineEndMs, ',')}\n${srtText(cue.text)}`).join('\n\n')}\n`
    };
  }
  if (format === 'vtt') {
    return {
      format, extension: 'vtt', mimeType: 'text/vtt', cueCount: cues.length,
      contents: `WEBVTT\n\n${cues.map((cue) => `${clock(cue.timelineStartMs, '.')} --> ${clock(cue.timelineEndMs, '.')}\n${vttText(cue.text)}`).join('\n\n')}\n`
    };
  }
  return {
    format, extension: 'ass', mimeType: 'text/x-ssa', cueCount: cues.length,
    contents: `[Script Info]\nScriptType: v4.00+\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,60,60,48,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${cues.map((cue) => {
      const start = Math.floor(cue.timelineStartMs / 10);
      const end = Math.max(start + 1, Math.ceil(cue.timelineEndMs / 10));
      return `Dialogue: 0,${assClock(start)},${assClock(end)},Default,,0,0,0,,${assText(cue.text)}`;
    }).join('\n')}\n`
  };
}
