import type { TimelineDocument } from '../../../shared/timelineTypes';

export type TimelineHistory = {
  readonly past: readonly TimelineDocument[];
  readonly present: TimelineDocument;
  readonly future: readonly TimelineDocument[];
  readonly limit: number;
};

export function createTimelineHistory(present: TimelineDocument, limit = 50): TimelineHistory {
  return { past: [], present, future: [], limit };
}

export function pushTimelineHistory(history: TimelineHistory, present: TimelineDocument): TimelineHistory {
  if (present === history.present) return history;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    present,
    future: []
  };
}

export function undoTimelineHistory(history: TimelineHistory): TimelineHistory | null {
  const previous = history.past.at(-1);
  if (previous === undefined) return null;
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, history.limit)
  };
}

export function redoTimelineHistory(history: TimelineHistory): TimelineHistory | null {
  const next = history.future[0];
  if (next === undefined) return null;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    present: next,
    future: history.future.slice(1)
  };
}
