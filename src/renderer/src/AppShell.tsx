import type { KeyboardEvent, ReactElement, ReactNode } from 'react';

import { useTheme } from './ThemeProvider';
import type { AppWorkspace } from './appWorkspaces';
import { shouldToggleThemeOnSwitchKeyDown } from './theme';
import { Button } from './ui';

function AppShellBackground(): ReactElement {
  return (
    <div className="atmosphere" aria-hidden="true">
      <div className="atmosphere__beam atmosphere__beam--left" />
      <div className="atmosphere__beam atmosphere__beam--right" />
      <div className="atmosphere__grain" />
    </div>
  );
}

type AppShellProps = {
  readonly activeWorkspace: AppWorkspace;
  readonly children: ReactNode;
};

export function AppShell({ activeWorkspace, children }: AppShellProps): ReactElement {
  const { mode, toggleTheme } = useTheme();
  const nextMode = mode === 'dark' ? 'light' : 'dark';

  const handleThemeSwitchKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!shouldToggleThemeOnSwitchKeyDown(event.key)) return;

    event.preventDefault();
    toggleTheme();
  };

  return (
    <main className="app-shell">
      <AppShellBackground />
      <header className="product-chrome" aria-label="Application chrome">
        <div className="product-chrome__context" aria-label="Current workspace">
          <span className="product-chrome__workspace">{activeWorkspace.label}</span>
          <span className="local-pill">Local</span>
        </div>
        <div className="product-chrome__actions">
          <Button
            className="theme-switch"
            role="switch"
            variant="ghost"
            aria-checked={mode === 'dark'}
            aria-label={`Theme is ${mode}. Switch to ${nextMode} theme.`}
            onClick={toggleTheme}
            onKeyDown={handleThemeSwitchKeyDown}
          >
            <span className="theme-switch__label">Theme</span>
            <span className="theme-switch__value">{mode}</span>
          </Button>
        </div>
      </header>
      {children}
    </main>
  );
}
