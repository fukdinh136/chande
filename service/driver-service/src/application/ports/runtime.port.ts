export interface Runtime {
  now(): Date;
  id(): string;
  opaque(): string;
  hash(value: string): string;
}
