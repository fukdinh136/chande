import type { IconName } from '@/design';

export interface VehicleTier {
  title: string;
  subtitle: string;
  icon: IconName;
  badge?: { label: string; tone: 'primary' | 'tertiary' };
}

// Mã loại xe theo Driver Service (BIKE, CAR_4, CAR_7); CAR là mã của bộ OSRM/Price local.
const TIERS: Record<string, VehicleTier> = {
  BIKE: { title: 'Chande Bike', subtitle: 'Xe máy · 1 khách · có mũ bảo hiểm', icon: 'two_wheeler', badge: { label: 'Nhanh', tone: 'tertiary' } },
  CAR_4: { title: 'Chande Car', subtitle: 'Ô tô 4 chỗ', icon: 'directions_car', badge: { label: 'Phổ biến', tone: 'primary' } },
  CAR_7: { title: 'Chande Car XL', subtitle: 'Ô tô 7 chỗ · rộng hành lý', icon: 'airport_shuttle' },
  CAR: { title: 'Chande Car', subtitle: 'Ô tô', icon: 'directions_car' },
};

export function vehicleTier(code: string): VehicleTier {
  return TIERS[code] ?? { title: code, subtitle: 'Loại xe', icon: 'local_taxi' };
}

/** Thứ tự ưu tiên khi tự chọn loại xe sau khi có báo giá. */
export const PREFERRED_VEHICLES = ['CAR_4', 'CAR', 'BIKE', 'CAR_7'];
