export class DriverError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
