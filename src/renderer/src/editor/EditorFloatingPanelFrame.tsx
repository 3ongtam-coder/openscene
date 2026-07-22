import { useRef, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';

import type { EditorFloatingPanel, EditorFloatingPanelId } from './editorLayoutPreferences';
import { getEditorFloatingPanelAfterKeyboardMove } from './editorLayoutPreferences';

type DragOrigin = {
  readonly clientX: number;
  readonly clientY: number;
  readonly panel: EditorFloatingPanel;
};

type EditorFloatingPanelFrameProps = {
  readonly children: ReactNode;
  readonly label: string;
  readonly onClose: (panelId: EditorFloatingPanelId) => void;
  readonly onFocusPanel: (panelId: EditorFloatingPanelId) => void;
  readonly onMovePanel: (panelId: EditorFloatingPanelId, panel: EditorFloatingPanel) => void;
  readonly panel: EditorFloatingPanel;
  readonly panelId: EditorFloatingPanelId;
};

type EditorFloatingPanelStyle = {
  readonly height: string;
  readonly left: string;
  readonly top: string;
  readonly width: string;
  readonly zIndex: number;
};

function getFloatingPanelStyle(panel: EditorFloatingPanel): EditorFloatingPanelStyle {
  return {
    height: `${panel.height}px`,
    left: `${panel.x}px`,
    top: `${panel.y}px`,
    width: `${panel.width}px`,
    zIndex: panel.zIndex
  };
}

export function EditorFloatingPanelFrame({ children, label, onClose, onFocusPanel, onMovePanel, panel, panelId }: EditorFloatingPanelFrameProps): ReactElement {
  const dragOriginRef = useRef<DragOrigin | null>(null);

  const moveFromKey = (key: string, shiftKey: boolean): void => {
    const nextPanel = getEditorFloatingPanelAfterKeyboardMove({ key, panel, shiftKey });
    if (nextPanel !== null) onMovePanel(panelId, nextPanel);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose(panelId);
      return;
    }

    const nextPanel = getEditorFloatingPanelAfterKeyboardMove({ key: event.key, panel, shiftKey: event.shiftKey });
    if (nextPanel === null) return;
    event.preventDefault();
    onMovePanel(panelId, nextPanel);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOriginRef.current = { clientX: event.clientX, clientY: event.clientY, panel };
    onFocusPanel(panelId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || dragOriginRef.current === null) return;
    const dragOrigin = dragOriginRef.current;
    onMovePanel(panelId, {
      ...dragOrigin.panel,
      x: dragOrigin.panel.x + event.clientX - dragOrigin.clientX,
      y: dragOrigin.panel.y + event.clientY - dragOrigin.clientY
    });
  };

  const onPointerRelease = (event: PointerEvent<HTMLDivElement>): void => {
    dragOriginRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      className="editor-floating-panel"
      role="region"
      tabIndex={0}
      aria-label={`${label} floating panel. Use arrow keys to move, Shift plus arrow for larger moves, or Escape to dock.`}
      style={getFloatingPanelStyle(panel)}
      onFocus={() => onFocusPanel(panelId)}
      onKeyDown={onKeyDown}
    >
      <div
        className="editor-floating-panel__handle"
        role="toolbar"
        aria-label={`${label} floating panel controls`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerRelease}
        onPointerCancel={onPointerRelease}
      >
        <span className="editor-floating-panel__title">{label}</span>
        <div className="editor-floating-panel__move-controls" aria-label={`${label} keyboard move buttons`}>
          <button className="button button--ghost editor-floating-panel__button" type="button" aria-label={`Move ${label} left`} onClick={() => moveFromKey('ArrowLeft', false)}>Left</button>
          <button className="button button--ghost editor-floating-panel__button" type="button" aria-label={`Move ${label} up`} onClick={() => moveFromKey('ArrowUp', false)}>Up</button>
          <button className="button button--ghost editor-floating-panel__button" type="button" aria-label={`Move ${label} down`} onClick={() => moveFromKey('ArrowDown', false)}>Down</button>
          <button className="button button--ghost editor-floating-panel__button" type="button" aria-label={`Move ${label} right`} onClick={() => moveFromKey('ArrowRight', false)}>Right</button>
        </div>
        <button className="button button--ghost editor-floating-panel__button" type="button" onClick={() => onClose(panelId)}>Dock</button>
      </div>
      <div className="editor-floating-panel__body">{children}</div>
    </div>
  );
}
