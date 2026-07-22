import type { ApiResponse, AppError, AppErrorCode } from '../shared/models';

export function ok<T>(value: T): ApiResponse<T> {
  return { ok: true, value };
}

export function fail<T>(code: AppErrorCode, message: string): ApiResponse<T> {
  return { ok: false, error: { code, message } };
}

export function errorFromUnknown(error: unknown, fallback: AppError): AppError {
  if (error instanceof Error && error.message.trim().length > 0) {
    return { code: fallback.code, message: error.message };
  }

  return fallback;
}
