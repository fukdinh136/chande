import {randomUUID} from 'expo-crypto';
import {BackendError, id, record} from '../backend/http';
import {quote, type Point, type Quote} from '../backend/clients';
import {DurableCommand, type Command} from '../backend/durable-command';
import {activeTrip, trip, tripPage, tripDetail} from '../driver/contracts/decode';
import {isTerminal, type Trip} from '../driver/contracts/models';
import {decodePolyline} from '../map/polyline';
import type {CustomerRuntime} from './provider';
import {customerError} from './errors';
import {bookingPoint, validBookingPoints, quoteRemaining, steadyNow, type QuoteClock} from './booking-policy';
import {locationMessage} from './location-errors';
import {canCancelTrip, definitiveCommandFailure, latestTrip} from './trip-policy';
import type {TripEventConnection} from '../backend/trip-events';

export type VehicleType = 'CAR_4' | 'CAR_7';
export type PointKind = 'pickup' | 'destination';
export type BookingFlow = 'points' | 'vehicle' | 'price' | 'confirm';
export type HistoryFilter = 'ALL' | 'COMPLETED' | 'CANCELLED';
export interface PointCandidate {kind: PointKind; point: Point; label: string}
export interface CustomerCommandResult {operation: string; phase: 'checking' | 'sending' | 'uncertain' | 'rejected' | 'confirmed'; message: string}
export interface BookingState {
  draft: {pickup: Point | null; destination: Point | null; vehicleType: VehicleType};
  selecting: PointKind;
  editing: boolean;
  candidate: PointCandidate | null;
  pointLabels: Record<PointKind, string | null>;
  flow: BookingFlow;
  sheet: 'collapsed' | 'expanded';
  gps: {loading: boolean; error: string | null};
  quoteChecking: boolean;
  quoteExpired: boolean;
  quoteProblem: string | null;
  step: 'draft' | 'quoting' | 'quote' | 'active';
  quote: Quote | null;
  line?: [number, number][];
  clockOffset: number;
  current: Trip | null;
  foreground: boolean;
  connection: TripEventConnection;
  lastCheckedAt: number | null;
  cancelConfirmation: {tripId: string} | null;
  commandResult: CustomerCommandResult | null;
  checked: boolean;
  activeLoading: boolean;
  commandsLoading: boolean;
  busy: boolean;
  error: string | null;
  activeError: string | null;
  previewError: string | null;
  history: {items: Trip[]; cursor: string | null; loaded: boolean; loading: boolean; error: string | null; filter: HistoryFilter; more: boolean; failedMore: boolean};
}

// One instance per authenticated Customer owner; views never own commands or active Trip.
export class CustomerBookingStore {
  private state: BookingState = {
    draft: {pickup: null, destination: null, vehicleType: 'CAR_4'}, selecting: 'pickup',
    editing: true, candidate: null, pointLabels: {pickup: null, destination: null}, flow: 'points', sheet: 'collapsed',
    gps: {loading: false, error: null}, quoteChecking: false, quoteExpired: false, quoteProblem: null,
    step: 'draft', quote: null, clockOffset: 0, current: null, checked: false,
    foreground: true, connection: 'paused', lastCheckedAt: null, cancelConfirmation: null, commandResult: null,
    activeLoading: false, commandsLoading: true, busy: false, error: null, activeError: null, previewError: null,
    history: {items: [], cursor: null, loaded: false, loading: false, error: null, filter: 'ALL', more: false, failedMore: false},
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private inputRevision = 0;
  private activeRevision = 0;
  private quoteControl: AbortController | null = null;
  private ownerEpoch: number;
  private alive = false;
  private restoring: Promise<void> | null = null;
  private clock: QuoteClock | null = null;
  private foreground = true;
  private needsClockSync = false;
  private locationControl: AbortController | null = null;
  private locationRevision = 0;
  private readJob: Promise<void> | null = null;
  private readAgain = false;
  private readControl: AbortController | null = null;
  private historyControl: AbortController | null = null;
  private historyRevision = 0;
  private historyCursors = new Set<string>();
  constructor(private runtime: CustomerRuntime, readonly commands: DurableCommand) {
    this.ownerEpoch = runtime.session.getOwnerEpoch();
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {this.listeners.add(fn); return () => {this.listeners.delete(fn);};};
  private valid(generation = this.generation) {return this.alive && generation === this.generation && this.ownerEpoch === this.runtime.session.getOwnerEpoch();}
  private publish(patch: Partial<BookingState>) {
    if (!this.valid()) return;
    this.state = {...this.state, ...patch};
    this.listeners.forEach(fn => fn());
  }
  start() {
    this.alive = true;
    this.generation++;
    this.publish({activeLoading: false, checked: false});
    void this.restoreCommands();
    void this.refresh(true);
    return () => {this.alive = false; this.generation++; this.activeRevision++; this.historyRevision++; this.readAgain = false; this.readControl?.abort(); this.historyControl?.abort(); this.quoteControl?.abort(); this.locationControl?.abort();};
  }
  private restoreCommands() {
    if (this.restoring) return this.restoring;
    this.publish({commandsLoading: true});
    const job = this.commands.restore().then(() => {
      const pending = this.commands.getSnapshot().pending;
      this.publish({error: null, ...(pending ? {commandResult: {operation: pending.operation, phase: 'uncertain', message: 'Có thao tác trước chưa rõ kết quả. Velox sẽ kiểm tra chuyến trước khi bạn thử lại.'} as CustomerCommandResult} : {})});
    }).catch(error => {
      this.publish({error: customerError(error)});
    }).finally(() => {if (this.restoring === job) this.restoring = null; this.publish({commandsLoading: false});});
    this.restoring = job;
    return job;
  }
  retryRecovery = async () => {
    if (!this.commands.getSnapshot().ready) await this.restoreCommands();
    await this.freshRead();
  };
  get draftLocked() {
    const command = this.commands.getSnapshot();
    return !this.valid() || !this.foreground || !this.state.checked || this.state.busy || !command.ready || command.busy || !!command.pending || !!this.state.current;
  }
  get canStartNewBooking() {
    const command = this.commands.getSnapshot();
    return this.valid() && this.foreground && this.state.checked && !!this.state.current && isTerminal(this.state.current) && !this.state.busy && command.ready && !command.busy && !command.pending;
  }
  newBooking = () => {
    if (!this.canStartNewBooking) return;
    this.cancelLocation(); this.invalidateRead(); this.invalidateDraft({pickup: null, destination: null, vehicleType: 'CAR_4'});
    this.publish({current: null, checked: false, activeLoading: false, pointLabels: {pickup: null, destination: null}, candidate: null, selecting: 'pickup', editing: true, flow: 'points', commandResult: null, cancelConfirmation: null, sheet: 'expanded'});
    void this.refresh(true);
  };
  setConnection = (connection: TripEventConnection) => {if (this.state.connection !== connection) this.publish({connection});};
  setSheet = (sheet: BookingState['sheet']) => {this.publish({sheet});};
  cancelLocation = () => {
    this.locationRevision++; this.locationControl?.abort(); this.locationControl = null;
    this.publish({gps: {loading: false, error: null}});
  };
  selectKind = (selecting: PointKind) => {
    if (this.draftLocked) return;
    this.cancelLocation(); this.invalidateDraft(this.state.draft);
    this.publish({selecting, editing: true, candidate: null, flow: 'points', sheet: 'expanded'});
  };
  proposePoint = (value: Point, label = 'Vị trí đã chọn') => {
    if (this.draftLocked) return false;
    this.cancelLocation(); this.invalidateDraft(this.state.draft);
    try {
      const candidate = {kind: this.state.selecting, point: bookingPoint(value), label};
      this.publish({candidate, editing: true, flow: 'points', error: null}); return true;
    } catch {this.publish({candidate: null, error: 'Tọa độ hoặc nhãn chưa hợp lệ. Vĩ độ từ -85,0511 đến 85,0511; kinh độ từ -180 đến 180, nhãn tối đa 500 ký tự.'}); return false;}
  };
  confirmPoint = () => {
    const candidate = this.state.candidate;
    if (!candidate || this.draftLocked) return;
    if (!this.setPoint(candidate.kind, candidate.point, candidate.label)) return;
    if (candidate.kind === 'pickup' && !this.state.draft.destination) this.publish({selecting: 'destination', editing: true});
  };
  cancelEditing = () => {
    this.cancelLocation(); this.publish({candidate: null, editing: false, error: null});
  };
  requestLocation = async (locate: (signal: AbortSignal) => Promise<Point>) => {
    if (this.draftLocked || this.state.gps.loading || !this.foreground) return;
    this.selectKind(this.state.selecting);
    const revision = ++this.locationRevision, generation = this.generation, kind = this.state.selecting;
    const control = new AbortController(); this.locationControl = control;
    const valid = () => this.valid(generation) && !control.signal.aborted && revision === this.locationRevision && kind === this.state.selecting && this.foreground;
    this.publish({gps: {loading: true, error: null}});
    try {
      const result = bookingPoint(await locate(control.signal));
      if (valid()) this.publish({candidate: {kind, point: result, label: 'Vị trí hiện tại'}, gps: {loading: false, error: null}});
    } catch (error) {if (valid()) this.publish({gps: {loading: false, error: locationMessage(error)}});}
  };
  setPoint = (kind: PointKind, value: Point, label = value.address || 'Vị trí đã chọn') => {
    if (this.draftLocked) return false;
    let parsed: Point;
    try {parsed = bookingPoint(value);} catch {this.publish({error: 'Vị trí chưa hợp lệ. Hãy chọn lại điểm trên bản đồ hoặc địa chỉ đã lưu.'}); return false;}
    this.cancelLocation();
    this.invalidateDraft({...this.state.draft, [kind]: parsed});
    this.publish({editing: false, candidate: null, pointLabels: {...this.state.pointLabels, [kind]: label}, flow: 'points'});
    return true;
  };
  setVehicle = (vehicleType: VehicleType) => {
    if (!this.draftLocked && ['CAR_4', 'CAR_7'].includes(vehicleType) && vehicleType !== this.state.draft.vehicleType) {
      this.cancelLocation(); this.invalidateDraft({...this.state.draft, vehicleType}); this.publish({flow: 'vehicle'});
    }
  };
  get pointsReady() {return !this.state.editing && !this.state.candidate && validBookingPoints(this.state.draft.pickup, this.state.draft.destination);}
  goTo = (flow: BookingFlow) => {
    if (this.draftLocked) return;
    if (flow === 'points') {this.cancelLocation(); this.publish({flow}); return;}
    if (!this.pointsReady) return;
    if (flow === 'confirm' && !this.quoteUsable) return;
    this.cancelLocation(); this.publish({flow, sheet: 'expanded'});
  };
  remainingQuoteMs = (wall = Date.now()) => quoteRemaining(this.clock, wall);
  get quoteUsable() {return !!this.state.quote && this.pointsReady && !this.state.quoteChecking && !this.state.quoteExpired && this.foreground && this.remainingQuoteMs() > 0;}
  checkQuote = () => {
    if (this.state.quote && this.remainingQuoteMs() <= 0 && !this.state.quoteExpired) this.publish({quoteExpired: true, quoteChecking: false});
  };
  setForeground = (foreground: boolean) => {
    if (this.foreground === foreground) {if (foreground) this.checkQuote(); return;}
    this.foreground = foreground;
    this.invalidateRead(); this.publish({activeLoading: false, checked: false, foreground});
    if (!foreground) {
      this.cancelLocation(); this.inputRevision++; this.quoteControl?.abort();
      if (this.state.step === 'quoting') this.publish({step: 'draft'});
      this.needsClockSync = !!this.state.quote;
      this.publish({quoteChecking: !!this.state.quote});
    } else {this.checkQuote(); void this.refresh(true);}
  };
  private invalidateDraft(draft: BookingState['draft']) {
    this.inputRevision++;
    this.quoteControl?.abort();
    this.clock = null; this.needsClockSync = false;
    this.publish({draft, quote: null, line: undefined, previewError: null, error: null, step: 'draft', quoteExpired: false, quoteChecking: false, quoteProblem: null});
  }
  private invalidateRead() {this.activeRevision++; this.readControl?.abort();}
  // Poll/manual reads join the current request. Socket invalidations queue one follow-up.
  refresh = (invalidated = false): Promise<void> => {
    if (!this.valid() || !this.foreground) return Promise.resolve();
    if (this.readJob) {if (invalidated) this.readAgain = true; return this.readJob;}
    const job = Promise.resolve().then(async () => {
      do {this.readAgain = false; await this.readOnce();} while (this.readAgain && this.valid() && this.foreground);
    }).finally(() => {if (this.readJob === job) this.readJob = null; if (this.readAgain && this.valid() && this.foreground) void this.refresh(true);});
    this.readJob = job; return job;
  };
  invalidate = () => this.refresh(true);
  private freshRead() {this.invalidateRead(); return this.refresh(true);}
  private async readOnce() {
    const generation = this.generation;
    if (this.restoring) await this.restoring;
    if (!this.valid(generation) || !this.foreground) return;
    const revision = this.activeRevision, control = new AbortController(); this.readControl = control;
    const started = steadyNow();
    this.publish({activeLoading: true});
    try {
      const result = await this.runtime.session.authorized(token => this.runtime.trips.active(token, control.signal));
      if (!this.valid(generation) || revision !== this.activeRevision || control.signal.aborted) return;
      if (this.state.quote && this.foreground && (this.needsClockSync || typeof result.serverDate === 'number' && Number.isFinite(result.serverDate))) {
        this.needsClockSync = false;
        if (typeof result.serverDate === 'number' && Number.isFinite(result.serverDate)) {
          const server = Math.max(result.serverDate + 1000 + Math.max(0, steadyNow() - started), this.clock ? this.clock.expires - this.remainingQuoteMs() : 0);
          this.clock = {server, expires: Date.parse(this.state.quote.expiresAt), wall: Date.now(), steady: steadyNow()};
          this.publish({quoteChecking: false, quoteExpired: this.remainingQuoteMs() <= 0});
        } else {
          this.clock = null;
          this.publish({quoteChecking: false, quoteExpired: true, quoteProblem: 'Cần lấy giá mới để xác nhận thời hạn sau khi quay lại ứng dụng.'});
        }
      }
      const next = activeTrip(result.data), previous = this.state.current;
      const pending = this.commands.getSnapshot().pending;
      let current = next ? latestTrip(previous, next) : previous;
      if (!next) {
        const knownId = previous && !isTerminal(previous) ? previous.tripId : pending?.operation === 'cancel' ? id(pending.body.tripId) : null;
        if (knownId) {
          const detail = await this.runtime.session.authorized(token => this.runtime.trips.detail(token, knownId, control.signal));
          if (!this.valid(generation) || revision !== this.activeRevision || control.signal.aborted) return;
          const actual = tripDetail(detail.data).trip;
          if (actual.tripId !== knownId) throw new BackendError('INVALID_RESPONSE');
          current = latestTrip(previous, actual);
          if (!isTerminal(current)) {
            this.publish({current, checked: false});
            throw new BackendError('TRIP_STATE_UNVERIFIED');
          }
        }
      }
      const cancelChanged = !!this.state.cancelConfirmation && (!current || current.tripId !== this.state.cancelConfirmation.tripId || !canCancelTrip(current));
      const common: Partial<BookingState> = {current, checked: true, activeError: null, lastCheckedAt: Date.now(), ...(cancelChanged ? {cancelConfirmation: null, commandResult: {operation: 'cancel', phase: 'rejected', message: 'Trạng thái chuyến đã thay đổi. Không thể tiếp tục yêu cầu hủy này.'}} : {})};
      if (current && !isTerminal(current)) {
        this.inputRevision++; this.quoteControl?.abort();
        this.cancelLocation(); this.clock = null;
        this.publish({...common, quote: null, line: undefined, candidate: null, editing: false, quoteChecking: false, step: 'active', sheet: 'expanded'});
      } else this.publish({...common, step: current ? 'active' : this.state.step === 'quoting' ? 'quoting' : this.state.quote ? 'quote' : 'draft'});
    } catch (error) {
      if (this.valid(generation) && revision === this.activeRevision && !control.signal.aborted) {
        if (this.needsClockSync && this.foreground) {this.clock = null; this.needsClockSync = false; this.publish({quoteChecking: false, quoteExpired: true});}
        this.publish({checked: false, activeError: customerError(error)});
      }
    } finally {if (this.readControl === control) this.readControl = null; if (this.valid(generation) && revision === this.activeRevision) this.publish({activeLoading: false});}
  }
  estimate = async () => {
    if (this.draftLocked || this.state.step === 'quoting' || !this.foreground) return;
    const {pickup, destination, vehicleType} = this.state.draft;
    if (!pickup || !destination || !this.pointsReady) {this.publish({error: 'Xác nhận điểm đón và điểm đến trước khi xem giá.'}); return;}
    this.cancelLocation();
    const generation = this.generation, revision = ++this.inputRevision;
    const control = new AbortController(); this.quoteControl = control;
    const valid = () => this.valid(generation) && revision === this.inputRevision && !control.signal.aborted;
    const started = steadyNow();
    this.clock = null;
    this.publish({step: 'quoting', flow: 'price', quote: null, line: undefined, error: null, previewError: null, quoteExpired: false, quoteChecking: false, quoteProblem: null});
    try {
      const result = await this.runtime.session.authorized(token => this.runtime.trips.estimate(token, pickup, destination, vehicleType, control.signal));
      if (!valid()) return;
      const decoded = quote(result.data), created = Date.parse(decoded.createdAt ?? '');
      const server = result.serverDate ?? created;
      if (!Number.isFinite(server)) throw new BackendError('QUOTE_CLOCK_UNAVAILABLE');
      this.clock = {wall: Date.now(), steady: steadyNow(), server: Math.max(server, Number.isFinite(created) ? created : server) + Math.max(0, steadyNow() - started) + (result.serverDate === null ? 0 : 1000), expires: Date.parse(decoded.expiresAt)};
      this.publish({quote: decoded, clockOffset: this.clock.server - this.clock.wall, step: 'quote', quoteExpired: this.remainingQuoteMs() <= 0});
      try {
        const preview = await this.runtime.session.authorized(token => this.runtime.routes.route(token, pickup, destination, vehicleType, control.signal));
        if (!valid()) return;
        const geometry = record(record(preview.data).polyline);
        if (geometry.encoding !== 'encoded_polyline' || geometry.precision !== 6 || typeof geometry.value !== 'string') throw new BackendError('INVALID_RESPONSE');
        this.publish({line: decodePolyline(geometry.value)});
      } catch {if (valid()) this.publish({line: undefined, previewError: 'Chưa tải được tuyến tham khảo. Báo giá vẫn được giữ.'});}
    } catch (error) {if (valid()) this.publish({step: 'draft', error: customerError(error)});}
  };
  create = async () => {
    const currentQuote = this.state.quote;
    if (this.draftLocked || !currentQuote || !this.pointsReady || this.state.quoteChecking || !this.foreground) return;
    if (!this.quoteUsable) {
      this.inputRevision++; this.quoteControl?.abort();
      this.clock = null;
      this.publish({quote: null, quoteExpired: true, step: 'draft', error: customerError(new BackendError('QUOTE_EXPIRED'))}); return;
    }
    await this.perform('create', () => {
      if (this.state.current) {this.publish({commandResult: {operation: 'create', phase: 'rejected', message: 'Đã có thông tin chuyến đi. Vui lòng kiểm tra trước khi đặt chuyến mới.'}}); return null;}
      if (!this.quoteUsable || this.state.quote?.quoteId !== currentQuote.quoteId) {
        this.publish({quote: null, quoteExpired: true, commandResult: {operation: 'create', phase: 'rejected', message: 'Báo giá không còn hợp lệ. Vui lòng lấy giá mới.'}}); return null;
      }
      return {key: randomUUID(), operation: 'create', body: {quoteId: currentQuote.quoteId}};
    });
  };
  get cancellationAllowed() {
    const command = this.commands.getSnapshot();
    return this.valid() && this.foreground && this.state.checked && canCancelTrip(this.state.current) && !this.state.busy && command.ready && !command.busy && !command.pending;
  }
  requestCancel = () => {
    if (this.cancellationAllowed && this.state.current) this.publish({cancelConfirmation: {tripId: this.state.current.tripId}, commandResult: null, sheet: 'expanded'});
  };
  dismissCancel = () => {if (!this.state.busy) this.publish({cancelConfirmation: null});};
  confirmCancel = () => {const target = this.state.cancelConfirmation?.tripId; return target ? this.cancel(target) : Promise.resolve();};
  cancel = async (tripId = this.state.current?.tripId) => {
    if (!tripId || !this.cancellationAllowed) return;
    await this.perform('cancel', () => {
      const current = this.state.current;
      if (!current || current.tripId !== tripId || !canCancelTrip(current)) {
        this.publish({cancelConfirmation: null, commandResult: {operation: 'cancel', phase: 'rejected', message: 'Chuyến đã thay đổi trạng thái. Không thể hủy chuyến lúc này.'}}); return null;
      }
      return {key: randomUUID(), operation: 'cancel', body: {tripId, version: current.version, reason: 'Khách hủy trên app'}};
    });
  };
  retryCommand = async () => {
    const command = this.commands.getSnapshot().pending;
    if (command) await this.perform(command.operation, () => command, true);
  };
  private acceptReceipt(receipt: Trip) {
    let current = this.state.current;
    if (!current) current = receipt;
    else if (current.tripId === receipt.tripId) {
      try {current = latestTrip(current, receipt);} catch { /* A replay cannot roll back an observed version. */ }
    }
    this.clock = null;
    this.publish({current, quote: null, line: undefined, checked: false, cancelConfirmation: null, sheet: 'expanded', step: 'active'});
  }
  private async perform(operation: string, build: () => Command | null, retry = false) {
    const journal = this.commands.getSnapshot();
    if (!this.valid() || !this.foreground || this.state.busy || !journal.ready || journal.busy || !retry && !!journal.pending) return;
    const generation = this.generation;
    this.inputRevision++; this.quoteControl?.abort();
    this.publish({busy: true, error: null, checked: false, commandResult: {operation, phase: 'checking', message: 'Đang kiểm tra chuyến trước khi gửi yêu cầu…'}});
    let dispatched = false, attempted = false, receipt: Trip | null = null;
    try {
      await this.freshRead();
      if (!this.valid(generation)) return;
      if (!this.foreground) {this.publish({commandResult: {operation, phase: retry ? 'uncertain' : 'rejected', message: 'Yêu cầu chưa được gửi lại. Vui lòng kiểm tra chuyến khi quay lại ứng dụng.'}}); return;}
      if (!this.state.checked) {
        this.publish({commandResult: {operation, phase: retry ? 'uncertain' : 'rejected', message: retry ? 'Chưa xác minh được chuyến. Thao tác cũ được giữ để kiểm tra lại.' : 'Chưa gửi yêu cầu vì chưa kiểm tra được chuyến. Vui lòng thử cập nhật lại.'}}); return;
      }
      const command = build();
      if (!command) return;
      attempted = true; this.invalidateRead();
      this.publish({checked: false, cancelConfirmation: null, commandResult: {operation, phase: 'sending', message: operation === 'cancel' ? 'Đang gửi yêu cầu hủy chuyến…' : 'Đang gửi yêu cầu đặt xe…'}});
      await this.commands.run(command, async cmd => {
        if (!this.valid(generation) || !this.foreground) throw new BackendError('CANCELLED');
        const response = await this.runtime.session.authorized(token => {
          dispatched = true;
          if (cmd.operation === 'create') return this.runtime.trips.create(token, id(cmd.body.quoteId), cmd.key);
          if (cmd.operation === 'cancel' && typeof cmd.body.version === 'number' && typeof cmd.body.reason === 'string') return this.runtime.trips.cancel(token, id(cmd.body.tripId), cmd.body.version, cmd.body.reason, cmd.key);
          throw new BackendError('INVALID_COMMAND');
        });
        if (!this.valid(generation)) throw new BackendError('CANCELLED');
        const decoded = trip(response.data);
        if (cmd.operation === 'cancel' && (decoded.tripId !== cmd.body.tripId || decoded.status !== 'CANCELLED')) throw new BackendError('INVALID_RESPONSE');
        const raw = record(response.data);
        if (cmd.operation === 'create' && raw.quoteId !== undefined && raw.quoteId !== cmd.body.quoteId) throw new BackendError('INVALID_RESPONSE');
        receipt = decoded;
        return response;
      });
      if (!this.valid(generation)) return;
      if (receipt) this.acceptReceipt(receipt);
      this.publish({commandResult: {operation, phase: 'confirmed', message: operation === 'cancel' ? 'Máy chủ đã xác nhận hủy chuyến.' : 'Máy chủ đã ghi nhận yêu cầu đặt xe.'}});
    } catch (error) {
      if (this.valid(generation)) {
        if (receipt) this.acceptReceipt(receipt);
        const uncertain = !!this.commands.getSnapshot().pending || dispatched && !definitiveCommandFailure(error);
        // A definitively rejected quote may already be consumed/expired; request a fresh one.
        if (!uncertain && operation === 'create') {this.clock = null; this.publish({quote: null});}
        this.publish({checked: false, commandResult: {operation, phase: uncertain ? 'uncertain' : 'rejected', message: uncertain ? 'Chưa rõ kết quả yêu cầu. Đừng đặt lại; hãy kiểm tra và thử lại thao tác đã lưu.' : `Yêu cầu chưa được chấp nhận. ${customerError(error)}`}});
      }
    }
    finally {
      if (this.valid(generation)) {
        if (attempted) await this.freshRead();
        if (this.valid(generation)) this.publish({busy: false});
      }
    }
  }
  // Rebooking only prepares a fresh draft. It never creates a command or carries a quote.
  rebook = async (source: Trip, replaceRevision?: number): Promise<{kind: 'ready' | 'blocked' | 'invalid'} | {kind: 'confirm'; revision: number}> => {
    if (!isTerminal(source) || !['CAR_4', 'CAR_7'].includes(source.vehicleType) || !validBookingPoints(source.pickup, source.destination)) return {kind: 'invalid'};
    const journal = this.commands.getSnapshot();
    if (!this.valid() || !this.foreground || this.state.busy || !journal.ready || journal.pending || journal.busy || this.state.current && !isTerminal(this.state.current)) return {kind: 'blocked'};
    const hasDraft = !!(this.state.draft.pickup || this.state.draft.destination || this.state.candidate || this.state.quote || this.state.draft.vehicleType !== 'CAR_4');
    const revision = this.inputRevision, generation = this.generation;
    if (hasDraft && replaceRevision !== revision) return {kind: 'confirm', revision};
    this.publish({busy: true, checked: false});
    try {
      await this.freshRead();
      if (!this.valid(generation) || !this.foreground || !this.state.checked || this.commands.getSnapshot().pending || this.state.current && !isTerminal(this.state.current)) return {kind: 'blocked'};
      if (revision !== this.inputRevision) return {kind: 'confirm', revision: this.inputRevision};
      this.cancelLocation();
      this.invalidateDraft({pickup: {...bookingPoint(source.pickup)}, destination: {...bookingPoint(source.destination)}, vehicleType: source.vehicleType as VehicleType});
      this.publish({current: null, pointLabels: {pickup: source.pickup.address || 'Vị trí đã chọn', destination: source.destination.address || 'Vị trí đã chọn'}, candidate: null, editing: false, selecting: 'pickup', flow: 'vehicle', sheet: 'expanded', cancelConfirmation: null, commandResult: null});
      return {kind: 'ready'};
    } finally {if (this.valid(generation)) this.publish({busy: false});}
  };
  setHistoryFilter = (filter: HistoryFilter) => {
    if (!this.valid() || filter === this.state.history.filter || !['ALL', 'COMPLETED', 'CANCELLED'].includes(filter)) return;
    this.historyRevision++; this.historyControl?.abort(); this.historyCursors.clear();
    this.publish({history: {items: [], cursor: null, loaded: false, loading: false, error: null, filter, more: false, failedMore: false}});
    void this.loadHistory();
  };
  loadHistory = async (more = false) => {
    if (!this.valid() || this.state.history.loading || more && !this.state.history.cursor) return;
    const generation = this.generation, revision = ++this.historyRevision, filter = this.state.history.filter, cursor = more ? this.state.history.cursor ?? undefined : undefined;
    const control = new AbortController(); this.historyControl = control;
    const valid = () => this.valid(generation) && revision === this.historyRevision && !control.signal.aborted;
    this.publish({history: {...this.state.history, loading: true, error: null, more, failedMore: false}});
    try {
      const result = await this.runtime.session.authorized(token => this.runtime.trips.history(token, cursor, filter === 'ALL' ? undefined : filter, control.signal));
      if (!valid()) return;
      const page = tripPage(result.data);
      if (page.items.some(item => !isTerminal(item) || filter !== 'ALL' && item.status !== filter) || page.nextCursor && (page.nextCursor === cursor || more && this.historyCursors.has(page.nextCursor))) throw new BackendError('INVALID_RESPONSE');
      const items = new Map<string, Trip>((more ? this.state.history.items : []).map(item => [item.tripId, item]));
      for (const item of page.items) {const old = items.get(item.tripId); if (!old || item.version >= old.version) items.set(item.tripId, item);}
      if (!more) this.historyCursors.clear();
      if (cursor) this.historyCursors.add(cursor);
      this.publish({history: {...this.state.history, items: [...items.values()], cursor: page.nextCursor, loaded: true, loading: false, error: null, more: false, failedMore: false}});
    } catch (error) {if (valid()) this.publish({history: {...this.state.history, loading: false, more: false, failedMore: more, error: customerError(error)}});}
    finally {if (this.historyControl === control) this.historyControl = null;}
  };
}
