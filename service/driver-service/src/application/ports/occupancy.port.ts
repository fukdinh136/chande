export interface Occupancy { lookup(ids: readonly string[]): Promise<Map<string, boolean>> }
