import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

import type { StatusTone } from '../appTypes';
import { classNames } from './classNames';

export type StatusCardProps = HTMLAttributes<HTMLDivElement> & {
  readonly children: ReactNode;
  readonly tone: StatusTone;
};

export function StatusCard({ children, className, tone, ...statusProps }: StatusCardProps): ReactElement {
  return (
    <div className={classNames('status-card', `status-card--${tone}`, className)} role="status" {...statusProps}>
      {children}
    </div>
  );
}
