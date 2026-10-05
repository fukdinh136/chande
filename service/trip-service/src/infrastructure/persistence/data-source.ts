import 'dotenv/config';
import { loadConfig } from '../../bootstrap/config';
import { createDataSource } from './connection';
export default createDataSource(loadConfig(process.env, 'migration').databaseUrl);
