import { describe, expect, it, vi } from 'vitest';

import {
  applyTimelineMenuState,
  createApplicationMenuTemplate,
  dispatchTimelineMenuCommand,
  getTimelineMenuItemId
} from '../src/main/applicationMenu';
import { IPC_CHANNELS } from '../src/shared/ipc';
import {
  TIMELINE_MENU_COMMAND_IDS,
  createDefaultTimelineMenuState,
  type TimelineMenuCommandId
} from '../src/shared/timelineMenuCommands';

type TestMenuItem = {
  checked: boolean;
  enabled: boolean;
  label: string;
};

function findTemplateItem(
  items: ReturnType<typeof createApplicationMenuTemplate>,
  commandId: TimelineMenuCommandId
): Electron.MenuItemConstructorOptions | null {
  const targetId = getTimelineMenuItemId(commandId);
  const pending = [...items];
  while (pending.length > 0) {
    const item = pending.shift();
    if (item === undefined) return null;
    if (item.id === targetId) return item;
    if (Array.isArray(item.submenu)) pending.push(...item.submenu);
  }
  return null;
}

describe('native application menu', () => {
  it('Given a Timeline command click, When a window is focused, Then only its web contents receives the typed command channel', () => {
    const send = vi.fn();

    dispatchTimelineMenuCommand('rewind', () => ({ webContents: { send } }));

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.timelineMenuCommand, 'rewind');
  });

  it('Given a Timeline command click, When no window is focused, Then no renderer receives a command', () => {
    const getFocusedWindow = vi.fn(() => null);

    dispatchTimelineMenuCommand('saveTimeline', getFocusedWindow);

    expect(getFocusedWindow).toHaveBeenCalledOnce();
  });

  it('Given the native template, When inspected, Then it exposes the Timeline hierarchy and typed command IDs', () => {
    const template = createApplicationMenuTemplate(vi.fn());
    const timelineMenu = template.find((item) => item.label === 'Timeline');
    const playPause = findTemplateItem(template, 'playPause');
    const inspectorLeft = findTemplateItem(template, 'setInspectorLeft');
    const projectFloating = findTemplateItem(template, 'toggleProjectFloating');

    expect(timelineMenu).toBeDefined();
    expect(playPause?.label).toBe('Play');
    expect(playPause?.enabled).toBe(false);
    expect(inspectorLeft?.type).toBe('radio');
    expect(projectFloating?.type).toBe('checkbox');

    expect(playPause?.id).toBe(getTimelineMenuItemId('playPause'));
  });

  it('Given renderer-owned menu state, When applied, Then enabled, checked, and Play/Pause label presentation update', () => {
    const state = createDefaultTimelineMenuState();
    const nextState = {
      ...state,
      playPauseLabel: 'Pause',
      commands: {
        ...state.commands,
        playPause: { enabled: true, checked: false },
        toggleLeftDock: { enabled: true, checked: true }
      }
    } as const;
    const items = new Map<string, TestMenuItem>();
    for (const commandId of TIMELINE_MENU_COMMAND_IDS) {
      items.set(getTimelineMenuItemId(commandId), { checked: false, enabled: false, label: commandId });
    }
    const menu = {
      getMenuItemById: (id: string): TestMenuItem | null => items.get(id) ?? null
    };

    applyTimelineMenuState(menu, nextState);

    expect(items.get(getTimelineMenuItemId('playPause'))).toEqual({ checked: false, enabled: true, label: 'Pause' });
    expect(items.get(getTimelineMenuItemId('toggleLeftDock'))?.checked).toBe(true);
    expect(items.get(getTimelineMenuItemId('saveTimeline'))?.enabled).toBe(false);
  });
});
