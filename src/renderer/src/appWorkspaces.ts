export const APP_WORKSPACE_IDS = ['edit', 'screen-recording', 'voice-generation'] as const;
const APP_WORKSPACE_FIRST_ID: AppWorkspaceId = 'edit';
const APP_WORKSPACE_LAST_ID: AppWorkspaceId = 'voice-generation';
const APP_WORKSPACE_NEXT_IDS: Record<AppWorkspaceId, AppWorkspaceId> = {
  edit: 'screen-recording',
  'screen-recording': 'voice-generation',
  'voice-generation': 'edit'
};
const APP_WORKSPACE_PREVIOUS_IDS: Record<AppWorkspaceId, AppWorkspaceId> = {
  edit: 'voice-generation',
  'screen-recording': 'edit',
  'voice-generation': 'screen-recording'
};

export type AppWorkspaceId = (typeof APP_WORKSPACE_IDS)[number];

export type AppWorkspaceNavigationKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

export type AppWorkspace = {
  readonly id: AppWorkspaceId;
  readonly label: string;
  readonly navId: string;
  readonly panelId: string;
  readonly statusLabel: string;
};

export const APP_WORKSPACES = [
  {
    id: 'edit',
    label: 'Edit',
    navId: 'app-workspace-nav-edit',
    panelId: 'app-workspace-panel-edit',
    statusLabel: 'Local'
  },
  {
    id: 'screen-recording',
    label: 'Screen Recording',
    navId: 'app-workspace-nav-screen-recording',
    panelId: 'app-workspace-panel-screen-recording',
    statusLabel: 'Local'
  },
  {
    id: 'voice-generation',
    label: 'Voice Generation',
    navId: 'app-workspace-nav-voice-generation',
    panelId: 'app-workspace-panel-voice-generation',
    statusLabel: 'Local'
  }
] as const satisfies readonly AppWorkspace[];

type AppWorkspaceNavigationInput = {
  readonly currentWorkspaceId: AppWorkspaceId;
  readonly key: AppWorkspaceNavigationKey;
};

function assertNever(value: never): never {
  throw new Error(`Unexpected workspace navigation key: ${String(value)}`);
}

export function getDefaultAppWorkspaceId(): AppWorkspaceId {
  return APP_WORKSPACE_FIRST_ID;
}

export function getNextAppWorkspaceId({ currentWorkspaceId, key }: AppWorkspaceNavigationInput): AppWorkspaceId {
  switch (key) {
    case 'ArrowDown':
      return APP_WORKSPACE_NEXT_IDS[currentWorkspaceId];
    case 'ArrowUp':
      return APP_WORKSPACE_PREVIOUS_IDS[currentWorkspaceId];
    case 'Home':
      return APP_WORKSPACE_FIRST_ID;
    case 'End':
      return APP_WORKSPACE_LAST_ID;
    default:
      return assertNever(key);
  }
}
