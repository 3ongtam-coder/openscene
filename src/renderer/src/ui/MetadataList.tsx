import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

import { classNames } from './classNames';

export type MetadataListItem = {
  readonly term: ReactNode;
  readonly description: ReactNode;
};

export type MetadataListProps = Omit<HTMLAttributes<HTMLDListElement>, 'children'> & {
  readonly items: readonly MetadataListItem[];
};

export function MetadataList({ className, items, ...listProps }: MetadataListProps): ReactElement {
  return (
    <dl className={classNames('profile-meta', className)} {...listProps}>
      {items.map((item, index) => (
        <div key={index}>
          <dt>{item.term}</dt>
          <dd>{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
