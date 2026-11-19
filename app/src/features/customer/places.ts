import {id, record} from '../backend/http';
import {point, type Point} from '../backend/clients';

export interface SavedPlace extends Point {id: string; label: string; addressText: string; isDefault: boolean}
export function savedPlace(value: unknown): SavedPlace {
  const item = record(value);
  if (item.label !== null && typeof item.label !== 'string' || typeof item.addressText !== 'string' || typeof item.isDefault !== 'boolean') throw new Error('INVALID_RESPONSE');
  return {...point(item), id: id(item.id), label: typeof item.label === 'string' ? item.label.trim() : '', addressText: item.addressText, isDefault: item.isDefault};
}
export function placeLabel(place: SavedPlace) {return place.label || place.addressText;}
export function savedPlaces(value: unknown): SavedPlace[] {
  if (!Array.isArray(value)) throw new Error('INVALID_RESPONSE');
  return value.map(savedPlace);
}
