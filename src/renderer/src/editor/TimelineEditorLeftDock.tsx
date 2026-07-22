import type { CSSProperties, ReactElement } from 'react';

import { AssetBin } from './AssetBin';
import { EDITOR_LEFT_DOCK_TAB_IDS, getDefaultEditorDockTabs } from './dockTabs';
import type { EditorLeftDockTabId } from './dockTabs';
import { ProjectRail } from './ProjectRail';
import type { TimelineEditorController } from './useTimelineEditor';
import { TabPanel, Tabs } from '../ui';
import type { TabDefinition } from '../ui';

type TimelineEditorLeftDockProps = {
  readonly activeTabId: EditorLeftDockTabId;
  readonly editor: TimelineEditorController;
  readonly floatingProjectVisible: boolean;
  readonly leftDockVisible: boolean;
  readonly onActiveTabChange: (tabId: EditorLeftDockTabId) => void;
};

const LEFT_DOCK_TAB_LABELS: Readonly<Record<EditorLeftDockTabId, string>> = {
  media: 'Media',
  project: 'Project'
};

const LEFT_DOCK_PANEL_STYLE = {
  display: 'grid',
  gridRow: '2 / -1',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden'
} as const satisfies CSSProperties;

const LEFT_DOCK_STYLE = {
  gridTemplateRows: 'auto minmax(0, 1fr)',
  height: '100%',
  minHeight: 0
} as const satisfies CSSProperties;

const LEFT_DOCK_HEADING_STYLE = {
  display: 'grid',
  gap: 'var(--space-3)'
} as const satisfies CSSProperties;

const LEFT_DOCK_TITLE_STYLE = {
  fontSize: 'var(--text-subhead)',
  letterSpacing: '-0.03em',
  lineHeight: 1.12,
  margin: 0
} as const satisfies CSSProperties;

function getLeftDockPanelStyle(activeTabId: EditorLeftDockTabId, tabId: EditorLeftDockTabId): CSSProperties {
  return activeTabId === tabId ? LEFT_DOCK_PANEL_STYLE : { ...LEFT_DOCK_PANEL_STYLE, display: 'none' };
}

function getLeftDockTabs(editor: TimelineEditorController): readonly TabDefinition<EditorLeftDockTabId>[] {
  const dockTabs = editor.project === null ? null : getDefaultEditorDockTabs(editor.project).left;

  return EDITOR_LEFT_DOCK_TAB_IDS.map((tabId) => {
    const dockTab = dockTabs?.find((tab) => tab.id === tabId);
    const label = dockTab?.label ?? LEFT_DOCK_TAB_LABELS[tabId];

    return dockTab?.disabled === true ? { id: tabId, label, disabled: true } : { id: tabId, label };
  });
}

export function TimelineEditorLeftDock({ activeTabId, editor, floatingProjectVisible, leftDockVisible, onActiveTabChange }: TimelineEditorLeftDockProps): ReactElement {
  const leftDockTabs = getLeftDockTabs(editor);

  return (
    <div className="editor-left-dock" id="editor-left-dock-panel" role="region" aria-labelledby="editor-left-dock-title" style={LEFT_DOCK_STYLE} hidden={!leftDockVisible}>
      <div className="panel-heading editor-left-dock__heading" style={LEFT_DOCK_HEADING_STYLE}>
        <div>
          <p className="section-kicker">Project dock</p>
          <h2 id="editor-left-dock-title" style={LEFT_DOCK_TITLE_STYLE}>Project and media</h2>
        </div>
        <Tabs activeTabId={activeTabId} className="transport-strip__buttons" idBase="left-dock" tabs={leftDockTabs} onActiveTabChange={onActiveTabChange} aria-label="Project and media sections" />
      </div>
      <TabPanel activeTabId={activeTabId} idBase="left-dock" tabId="project" style={getLeftDockPanelStyle(activeTabId, 'project')}>
        {floatingProjectVisible ? <div className="empty-slate">Project dock is floating above the workspace.</div> : <ProjectRail editor={editor} />}
      </TabPanel>
      <TabPanel activeTabId={activeTabId} idBase="left-dock" tabId="media" style={getLeftDockPanelStyle(activeTabId, 'media')}>
        <AssetBin editor={editor} />
      </TabPanel>
    </div>
  );
}
