import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

import { classNames } from './classNames';

export type PanelProps = HTMLAttributes<HTMLElement> & {
  readonly children: ReactNode;
};

export type PanelHeadingProps = HTMLAttributes<HTMLDivElement> & {
  readonly children: ReactNode;
};

export function Panel({ children, className, ...panelProps }: PanelProps): ReactElement {
  return <section className={className} {...panelProps}>{children}</section>;
}

export function PanelHeading({ children, className, ...headingProps }: PanelHeadingProps): ReactElement {
  return <div className={classNames('panel-heading', className)} {...headingProps}>{children}</div>;
}
