import { z } from 'zod';
import { JsonHttpClient, TransportError } from './http';
export class MatchingClient {
  constructor(private readonly http: JsonHttpClient) {}
  async send(kind: 'search' | 'cancel', payload: Record<string, unknown>, requestId: string): Promise<void> {
    const path = kind === 'search' ? '/internal/matching/requests' : `/internal/matching/requests/${payload.tripId}/cancel`;
    const ack = await this.http.post(path, payload, requestId, z.object({ commandId: z.uuid(), accepted: z.literal(true) }).strict(), 202);
    if (ack.commandId !== payload.commandId) throw new TransportError(false, 'INVALID_ACK');
  }
}
