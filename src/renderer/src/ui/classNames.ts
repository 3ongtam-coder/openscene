export function classNames(...values: readonly (string | undefined)[]): string {
  return values.filter((value) => value !== undefined && value.length > 0).join(' ');
}
