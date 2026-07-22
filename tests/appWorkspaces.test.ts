import { describe, expect, it } from 'vitest';

import {
  APP_WORKSPACE_IDS,
  APP_WORKSPACES,
  getDefaultAppWorkspaceId,
  getNextAppWorkspaceId
} from '../src/renderer/src/appWorkspaces';

describe('app workspaces', () => {
  it('returns a stable ordered workspace model that defaults to edit', () => {
    // Given / When
    const workspaces = APP_WORKSPACES;

    // Then
    expect(APP_WORKSPACE_IDS).toEqual(['edit', 'screen-recording', 'voice-generation']);
    expect(getDefaultAppWorkspaceId()).toBe('edit');
    expect(workspaces.map((workspace) => workspace.id)).toEqual(APP_WORKSPACE_IDS);
    expect(workspaces.map((workspace) => workspace.label)).toEqual(['Edit', 'Screen Recording', 'Voice Generation']);
    expect(workspaces.map((workspace) => workspace.navId)).toEqual([
      'app-workspace-nav-edit',
      'app-workspace-nav-screen-recording',
      'app-workspace-nav-voice-generation'
    ]);
    expect(workspaces.map((workspace) => workspace.panelId)).toEqual([
      'app-workspace-panel-edit',
      'app-workspace-panel-screen-recording',
      'app-workspace-panel-voice-generation'
    ]);
    expect(workspaces.map((workspace) => workspace.statusLabel)).toEqual([
      'Local',
      'Local',
      'Local'
    ]);
  });

  it('moves focus across workspaces with ArrowUp, ArrowDown, Home, and End wrap', () => {
    // Given / When / Then
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'edit', key: 'ArrowDown' })).toBe('screen-recording');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'screen-recording', key: 'ArrowDown' })).toBe('voice-generation');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'voice-generation', key: 'ArrowDown' })).toBe('edit');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'edit', key: 'ArrowUp' })).toBe('voice-generation');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'screen-recording', key: 'ArrowUp' })).toBe('edit');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'voice-generation', key: 'ArrowUp' })).toBe('screen-recording');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'voice-generation', key: 'Home' })).toBe('edit');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'edit', key: 'End' })).toBe('voice-generation');
  });
});
