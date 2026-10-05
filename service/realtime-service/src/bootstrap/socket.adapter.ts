import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server, ServerOptions } from 'socket.io';
export class RealtimeSocketAdapter extends IoAdapter {
  constructor(app: INestApplicationContext, private readonly origins: readonly string[]) { super(app); }
  createIOServer(port: number, options?: Partial<ServerOptions>): Server {
    const configured: Partial<ServerOptions> = {
      ...options, cors: { origin: [...this.origins], credentials: false },
      allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        callback(null, origin === undefined || this.origins.includes(origin));
      },
    };
    return super.createIOServer(port, configured) as Server;
  }
}
