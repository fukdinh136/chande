export class RealtimeError extends Error {
  constructor(readonly code: string) { super(code); }
}
