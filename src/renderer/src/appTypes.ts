import type { AppError } from '../../shared/models';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

export type StatusMessage = {
  readonly tone: StatusTone;
  readonly text: string;
};

export function errorMessage(error: AppError): string {
  return `${error.message} (${error.code})`;
}
