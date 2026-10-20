import type { LengthUnit } from '../model/types';

export const MM_PER_INCH = 25.4;

export function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function fmtLen(mm: number, units: LengthUnit, digits?: number): string {
  if (units === 'in') return `${round(mm / MM_PER_INCH, digits ?? 2)} in`;
  return `${round(mm, digits ?? 1)} mm`;
}

export function fmtSize(a: number, b: number, units: LengthUnit, c?: number): string {
  const conv = (v: number) => (units === 'in' ? round(v / MM_PER_INCH, 2) : round(v, 1));
  const parts = [a, b, ...(c != null ? [c] : [])].map(conv);
  return `${parts.join(' × ')} ${units}`;
}

export function toUnit(mm: number, units: LengthUnit): number {
  return units === 'in' ? mm / MM_PER_INCH : mm;
}

export function fromUnit(v: number, units: LengthUnit): number {
  return units === 'in' ? v * MM_PER_INCH : v;
}
