import { REASON_PRECEDENCE } from './policy.js';
import type { ReasonCode, ReasonDetail } from './types.js';

export function sortReasonCodes(codes: readonly ReasonCode[]): ReasonCode[] {
  const unique: ReasonCode[] = [];
  for (const code of codes) {
    if (!unique.includes(code)) unique.push(code);
  }
  return unique.sort((a, b) => {
    const ia = REASON_PRECEDENCE.indexOf(a);
    const ib = REASON_PRECEDENCE.indexOf(b);
    const sa = ia === -1 ? 1000 : ia;
    const sb = ib === -1 ? 1000 : ib;
    if (sa !== sb) return sa - sb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function sortReasonDetails(details: readonly ReasonDetail[]): ReasonDetail[] {
  const order = sortReasonCodes(details.map((row) => row.code));
  return [...details].sort((a, b) => {
    const ia = order.indexOf(a.code);
    const ib = order.indexOf(b.code);
    if (ia !== ib) return ia - ib;
    const pa = a.parameter ?? '';
    const pb = b.parameter ?? '';
    if (pa < pb) return -1;
    if (pa > pb) return 1;
    return a.humanMessage < b.humanMessage ? -1 : a.humanMessage > b.humanMessage ? 1 : 0;
  });
}

export function primaryReasonOf(codes: readonly ReasonCode[]): ReasonCode | null {
  const sorted = sortReasonCodes(codes);
  return sorted[0] ?? null;
}

export function reasonDetail(
  code: ReasonCode,
  humanMessage: string,
  extras: Partial<ReasonDetail> = {},
): ReasonDetail {
  return {
    code,
    parameter: extras.parameter ?? null,
    required: extras.required ?? null,
    actual: extras.actual ?? null,
    conditionContext: extras.conditionContext ?? [],
    humanMessage,
  };
}
