export interface Command { key: string; operation: string; body: Record<string, unknown> }
export interface CommandStorage { read(): Promise<Command | null>; write(command: Command | null): Promise<void> }
// Persist intent before sending. An uncertain response keeps the exact key/body across restarts.
export class DurableCommand {
  private state: { pending: Command | null; ready: boolean; busy: boolean } = {pending:null,ready:false,busy:false};
  private listeners = new Set<() => void>();
  constructor(private readonly storage: CommandStorage) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<typeof this.state>) { this.state={...this.state,...patch};this.listeners.forEach(f=>f()); }
  async restore() { this.publish({pending:await this.storage.read(),ready:true}); }
  async run<T>(command: Command, send: (command: Command) => Promise<T>): Promise<T> {
    if (!this.state.ready || this.state.busy) throw new Error('COMMAND_BUSY');
    const pending=this.state.pending;
    if (pending && JSON.stringify(pending)!==JSON.stringify(command)) throw new Error('COMMAND_UNRESOLVED');
    this.publish({busy:true});
    try {
      await this.storage.write(command);this.publish({pending:command});
      let result:T;
      try { result=await send(command); }
      catch(error) {
        const e=error as {status?:number;code?:string};
        if (e.status && e.status>=400 && e.status<500 && ![408,429].includes(e.status) && e.code!=='REQUEST_IN_PROGRESS') {
          await this.storage.write(null);this.publish({pending:null});
        }
        throw error;
      }
      await this.storage.write(null);this.publish({pending:null});return result;
    } finally { this.publish({busy:false}); }
  }
}
