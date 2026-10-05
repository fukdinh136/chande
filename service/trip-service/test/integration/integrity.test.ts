import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase, clearDatabase } from '../database';
import { quote, rider, now } from '../fixtures';
import { CreateTrip } from '../../src/application/use-cases/create';
test('database rejects nullable completed fare and JSON projections that bypass active constraints', async () => {
  const store = await testDatabase(); await clearDatabase(store);
  try {
    await store.transaction(tx => tx.saveQuote(quote())); const trip = (await new CreateTrip(store, { id: randomUUID, now: () => now }).execute(rider, quote().quoteId, randomUUID())).value;
    await assert.rejects(store.db.query("UPDATE trips SET status='COMPLETED',driver_id=$2,vehicle_id=$3,final_fare=NULL WHERE id=$1", [trip.tripId, randomUUID(), randomUUID()]), { code: '23514' });
    await assert.rejects(store.db.query("UPDATE trips SET data=jsonb_set(data,'{riderId}',to_jsonb($2::text)) WHERE id=$1", [trip.tripId, randomUUID()]), { code: '23514' });
    await assert.rejects(store.db.query("UPDATE trip_quotes SET data=jsonb_set(data,'{consumedTripId}','null') WHERE id=$1", [quote().quoteId]), { code: '23514' });
  } finally { await store.db.destroy(); }
});
