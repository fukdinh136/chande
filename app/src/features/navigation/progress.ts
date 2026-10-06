import { cumulativeDistances, nearestOnLine, type LngLat } from './geo';
import type { PlannedRoute } from './model';

// Theo dõi vị trí trên tuyến cho chế độ dự phòng (iOS, web) khi không có MapLibre Navigation SDK native.
export interface GuidanceState {
  stepIndex: number;
  /** Quãng đường (m) tới thao tác kế tiếp. */
  distanceToManeuver: number;
  distanceRemaining: number;
  durationRemaining: number;
  /** Khoảng cách (m) từ vị trí GPS tới tuyến. */
  offset: number;
  offRoute: boolean;
  arrived: boolean;
}

const OFF_ROUTE_M = 50;
const ARRIVAL_M = 40;

export class RouteTracker {
  private readonly cumulative: number[];
  private readonly total: number;
  private readonly stepStarts: number[];
  private segment = 0;
  private outside = 0;

  constructor(readonly route: PlannedRoute) {
    this.cumulative = cumulativeDistances(route.geometry);
    this.total = this.cumulative[this.cumulative.length - 1];
    const starts: number[] = [];
    let segment = 0, expected = 0;
    for (const [index, step] of route.steps.entries()) {
      if (index === 0) starts.push(0);
      else if (index === route.steps.length - 1) starts.push(this.total);
      else {
        const position = nearestOnLine(route.geometry, step.maneuver.location, { cumulative: this.cumulative, fromSegment: segment, expectedAlong: expected });
        segment = position.segment;
        starts.push(Math.max(starts[index - 1], position.along));
      }
      expected = starts[index] + step.distance;
    }
    this.stepStarts = starts;
  }

  update(location: LngLat): GuidanceState {
    // Chỉ tìm tiến lên một chút so với lần trước để không nhảy về đoạn đã đi qua ở chỗ tuyến tự cắt.
    const position = nearestOnLine(this.route.geometry, location, { cumulative: this.cumulative, fromSegment: Math.max(0, this.segment - 3) });
    this.outside = position.offset > OFF_ROUTE_M ? this.outside + 1 : 0;
    if (position.offset <= OFF_ROUTE_M) this.segment = position.segment;
    const along = position.along;
    let stepIndex = 0;
    for (let i = 0; i < this.stepStarts.length; i++) if (this.stepStarts[i] <= along + 1) stepIndex = i;
    stepIndex = Math.min(stepIndex, this.route.steps.length - 2);
    const distanceRemaining = Math.max(0, this.total - along);
    return {
      stepIndex: Math.max(0, stepIndex),
      distanceToManeuver: Math.max(0, (this.stepStarts[stepIndex + 1] ?? this.total) - along),
      distanceRemaining,
      durationRemaining: this.total > 0 ? this.route.duration * (distanceRemaining / this.total) : 0,
      offset: position.offset,
      offRoute: this.outside >= 3,
      arrived: distanceRemaining <= ARRIVAL_M && position.offset <= OFF_ROUTE_M,
    };
  }
}
