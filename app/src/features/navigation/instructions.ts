import { cardinal } from './geo';
import type { ManeuverModifier, RouteStep } from './model';

// Câu chỉ dẫn tiếng Việt sinh từ loại thao tác OSRM. routing-service chưa có formatter (instruction = null),
// nên app tự tạo cho cả banner, giọng đọc và danh sách bước.
export interface InstructionContext {
  /** Tên điểm đích dùng trong câu, ví dụ "điểm đón", "điểm trả". */
  destinationLabel: string;
}

const TURN: Record<ManeuverModifier, string> = {
  uturn: 'quay đầu',
  'sharp right': 'rẽ gắt sang phải',
  right: 'rẽ phải',
  'slight right': 'chếch sang phải',
  straight: 'đi thẳng',
  'slight left': 'chếch sang trái',
  left: 'rẽ trái',
  'sharp left': 'rẽ gắt sang trái',
};
const ORDINALS = ['nhất', 'hai', 'ba', 'tư', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười'];

export const capitalize = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
/** Ghép các vế bằng dấu phẩy và viết hoa chữ đầu câu. */
export const sentence = (...parts: string[]) => capitalize(parts.filter(Boolean).join(', '));

function sideOf(modifier: ManeuverModifier | null): 'trái' | 'phải' | null {
  if (modifier?.endsWith('left')) return 'trái';
  if (modifier?.endsWith('right')) return 'phải';
  return null;
}
const onto = (name: string) => (name ? ` vào ${name}` : '');
const along = (name: string) => (name ? ` trên ${name}` : '');

/** Câu (chữ thường đầu câu) mô tả thao tác tại điểm bắt đầu của bước. */
export function maneuverPhrase(step: RouteStep, context: InstructionContext): string {
  const { type, modifier, exit, bearingAfter } = step.maneuver;
  const name = step.name.trim();
  const turn = modifier ? TURN[modifier] : 'rẽ';
  const side = sideOf(modifier);
  switch (type) {
    case 'depart':
      return `đi về hướng ${cardinal(bearingAfter)}${along(name)}`;
    case 'arrive':
      return `đã đến ${context.destinationLabel}${side ? ` ở bên ${side}` : ''}`;
    case 'new name':
      return name ? `đi tiếp vào ${name}` : 'đi tiếp';
    case 'continue':
      if (!modifier || modifier === 'straight') return `đi thẳng${along(name)}`;
      if (modifier === 'uturn') return `quay đầu${onto(name)}`;
      return `tiếp tục ${turn}${along(name)}`;
    case 'merge':
      return `nhập làn${side ? ` bên ${side}` : ''}${onto(name)}`;
    case 'on ramp':
      return `đi vào đường dẫn${side ? ` bên ${side}` : ''}${name ? ` lên ${name}` : ''}`;
    case 'off ramp':
      return `đi vào lối ra${side ? ` bên ${side}` : ''}${name ? ` về ${name}` : ''}`;
    case 'fork':
      return side ? `tại ngã rẽ, đi về bên ${side}${onto(name)}` : `tại ngã rẽ, đi thẳng${onto(name)}`;
    case 'end of road':
      return `cuối đường, ${turn}${onto(name)}`;
    case 'roundabout':
    case 'rotary':
      return exit ? `vào vòng xuyến, đi theo lối ra thứ ${ORDINALS[exit - 1] ?? exit}${onto(name)}` : `vào vòng xuyến${onto(name)}`;
    case 'roundabout turn':
      return `tại vòng xuyến, ${turn}${onto(name)}`;
    case 'exit roundabout':
    case 'exit rotary':
      return `ra khỏi vòng xuyến${onto(name)}`;
    case 'turn':
      return `${turn}${onto(name)}`;
    default:
      return modifier && modifier !== 'straight' ? `${turn}${onto(name)}` : `đi tiếp${along(name)}`;
  }
}

/** Câu báo trước thao tác của bước kế tiếp; điểm đích đọc là "đến điểm đón". */
export function upcomingPhrase(next: RouteStep, context: InstructionContext): string {
  return next.maneuver.type === 'arrive' ? `đến ${context.destinationLabel}` : maneuverPhrase(next, context);
}

/** Câu đọc ngay trước thao tác; với điểm đích là "điểm đón ở bên phải". */
export function imminentPhrase(next: RouteStep, context: InstructionContext): string {
  if (next.maneuver.type !== 'arrive') return maneuverPhrase(next, context);
  const side = sideOf(next.maneuver.modifier);
  return side ? `${context.destinationLabel} ở bên ${side}` : `sắp đến ${context.destinationLabel}`;
}

/** Khoảng cách viết để máy đọc, ví dụ "200 mét", "1,5 ki lô mét". */
export function spokenDistance(meters: number): string {
  if (meters >= 1000) {
    const km = Math.round(meters / 100) / 10;
    return `${Number.isInteger(km) ? km : km.toFixed(1).replace('.', ',')} ki lô mét`;
  }
  const rounded = meters >= 100 ? Math.round(meters / 50) * 50 : Math.max(10, Math.round(meters / 10) * 10);
  return `${rounded} mét`;
}
