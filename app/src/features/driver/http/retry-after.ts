// RFC 9110: non-negative delay-seconds or HTTP-date. Store an absolute local
// deadline once at receipt, so remounts never restart the wait. Date accounts
// for server/client clock skew when the response supplies it.
export function retryAfterDeadline(value: string | null, receivedAt: number, serverDate: string | null): number | null {
  if (!value) return null;
  const raw = value.trim();
  let delay: number;
  if (/^\d+$/.test(raw)) delay = Number(raw) * 1000;
  else {
    const httpDate = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2} GMT|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;
    if (!httpDate.test(raw)) return null;
    const deadline = Date.parse(raw), serverNow = serverDate ? Date.parse(serverDate) : NaN;
    if (!Number.isFinite(deadline)) return null;
    delay = Math.max(0, deadline - (Number.isFinite(serverNow) ? serverNow : receivedAt));
  }
  const result = receivedAt + delay;
  return Number.isSafeInteger(result) && result <= 8640000000000000 ? result : null;
}
