import type { ButtonHTMLAttributes, ReactElement } from 'react';

import { classNames } from './classNames';

export type ButtonVariant = 'default' | 'primary' | 'record' | 'stop' | 'ghost';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  readonly type?: 'button' | 'submit' | 'reset';
  readonly variant?: ButtonVariant;
};

const buttonVariantClass: Readonly<Record<ButtonVariant, string | undefined>> = {
  default: undefined,
  primary: 'button--primary',
  record: 'button--record',
  stop: 'button--stop',
  ghost: 'button--ghost'
};

export function Button({ className, type = 'button', variant = 'default', ...buttonProps }: ButtonProps): ReactElement {
  return <button className={classNames('button', buttonVariantClass[variant], className)} type={type} {...buttonProps} />;
}
