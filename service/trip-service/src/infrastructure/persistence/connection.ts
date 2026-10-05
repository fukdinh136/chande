import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { InitialTripSchema1791158400000 } from './migrations/1791158400000-initial';
import { TripIntegrity1791158400001 } from './migrations/1791158400001-integrity';
export function createDataSource(url: string, poolSize = 10): DataSource {
  return new DataSource({ type: 'postgres', url, synchronize: false, migrationsRun: false, migrations: [InitialTripSchema1791158400000, TripIntegrity1791158400001], migrationsTableName: 'trip_migrations', extra: { max: poolSize, connectionTimeoutMillis: 5000 }, logging: false });
}
