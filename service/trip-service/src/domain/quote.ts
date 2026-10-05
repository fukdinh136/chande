import { DomainError } from './error';
import type { Quote, QuoteFare, RouteSummary } from './models';
const MAX_MONEY = 9223372036854775807n;
export function validateMoney(value: string): void {
  if (!/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > MAX_MONEY) throw new DomainError('INVALID_FARE');
}
export function validateEstimate(route: RouteSummary, fare: QuoteFare): void {
  if (![route.distanceMeters, route.durationSeconds].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 2147483647)) throw new DomainError('INVALID_ROUTE');
  if (fare.currency !== 'VND' || !fare.breakdown.length) throw new DomainError('INVALID_FARE');
  validateMoney(fare.amount);
  let sum = 0n;
  for (const line of fare.breakdown) { if (!line.code.trim()) throw new DomainError('INVALID_FARE'); validateMoney(line.amount); sum += BigInt(line.amount); }
  if (sum !== BigInt(fare.amount)) throw new DomainError('INVALID_FARE');
}
export function assertUsableQuote(quote: Quote, riderId: string, now: Date): void {
  if (quote.riderId !== riderId) throw new DomainError('RESOURCE_NOT_FOUND');
  if (quote.consumedTripId) throw new DomainError('QUOTE_ALREADY_USED');
  if (now.getTime() >= Date.parse(quote.expiresAt)) throw new DomainError('QUOTE_EXPIRED');
}
