import {useCallback, useEffect, useState} from 'react';
import {router, useLocalSearchParams} from 'expo-router';
import {id} from '../backend/http';
import {tripDetail} from '../driver/contracts/decode';
import type {TripDetail} from '../driver/contracts/models';
import {Screen, Busy, Notice, Action, Card} from '../ui/components';
import {TripCard, tripLabels} from '../ui/trip-card';
import {useCustomer} from './provider';
import {customerError} from './errors';
import {ThemedText} from '@/components/themed-text';
import {vnd} from '../ui/design';
import {driverDate, actorLabels} from '../driver/presentation/format';
import {isTerminal} from '../driver/contracts/models';
import {RebookAction} from './rebook-action';
import {Avatar} from '../ui/avatar';

export function CustomerTripDetail() {
  const {id: tripId} = useLocalSearchParams<{id: string}>();
  return <TripDetailContent key={tripId} tripId={tripId}/>;
}
function TripDetailContent({tripId}: {tripId: string}) {
  const runtime = useCustomer();
  const [result, setResult] = useState<{detail: TripDetail | null; error: string | null; loading: boolean}>({detail: null, error: null, loading: true});
  const [attempt, setAttempt] = useState(0);
  const back = useCallback(() => {if (router.canGoBack()) router.back(); else router.replace('/customer/history');}, []);
  useEffect(() => {
    const control = new AbortController();
    const epoch = runtime.session.getOwnerEpoch();
    const valid = () => !control.signal.aborted && epoch === runtime.session.getOwnerEpoch();
    void (async () => {
      try {
        const response = await runtime.session.authorized(token => runtime.trips.detail(token, id(tripId), control.signal));
        const detail = tripDetail(response.data);
        if (detail.trip.tripId !== id(tripId)) throw new Error('INVALID_RESPONSE');
        if (valid()) setResult({detail, error: null, loading: false});
      } catch (error) {if (valid()) {const status = error && typeof error === 'object' && 'status' in error ? error.status : null; setResult({detail: null, error: status === 404 ? 'Chuyến không tồn tại hoặc bạn không được xem chuyến này.' : status === 403 ? 'Bạn không có quyền xem chuyến này.' : customerError(error), loading: false});}}
    })();
    return () => control.abort();
  }, [runtime, tripId, attempt]);
  return <Screen title="Chi tiết chuyến đi">
    <Action label="Quay lại" variant="secondary" onPress={back}/><Busy visible={result.loading}/>
    {result.error && <><Notice tone="error">{result.error}</Notice><Action label="Thử tải lại chi tiết" onPress={() => {setResult({detail: null, error: null, loading: true}); setAttempt(old => old + 1);}}/></>}
    {result.detail && <>
      <TripCard trip={result.detail.trip}/>
      {(result.detail.trip.driver || result.detail.trip.vehicle) && <Card><ThemedText type="smallBold">Tài xế và phương tiện</ThemedText>
        <Avatar name={result.detail.trip.driver?.fullName || 'Velox'} url={result.detail.trip.driver?.avatarUrl}/>
        <ThemedText>{result.detail.trip.driver?.fullName || 'Chưa có tên tài xế'}</ThemedText>
        <Notice>Biển số: {result.detail.trip.vehicle?.licensePlate || 'Chưa có thông tin'}</Notice>
        <Notice>{[result.detail.trip.vehicle?.brand, result.detail.trip.vehicle?.color].filter(Boolean).join(' · ') || 'Chưa có mô tả xe'}</Notice>
      </Card>}
      {result.detail.trip.route && <Card><ThemedText type="smallBold">Hành trình</ThemedText><Notice>{(result.detail.trip.route.distanceMeters / 1000).toLocaleString('vi-VN', {maximumFractionDigits: 1})} km · {Math.ceil(result.detail.trip.route.durationSeconds / 60)} phút hành trình</Notice></Card>}
      <Card><ThemedText type="smallBold">Chi phí chuyến</ThemedText><Notice>{result.detail.trip.fare.finalAmount === null ? 'Giá dự kiến' : 'Giá chốt'}: {vnd(result.detail.trip.fare.finalAmount ?? result.detail.trip.fare.estimatedAmount)}</Notice>
        {result.detail.trip.fare.breakdown?.length ? result.detail.trip.fare.breakdown.map((entry, index) => <Notice key={`${entry.code}/${index}`}>{fareLabel(entry.code)}: {vnd(entry.amount)}</Notice>) : <Notice>Chưa có bảng thành phần chi phí từ máy chủ.</Notice>}
      </Card>
      <Card><ThemedText type="smallBold">Diễn biến chuyến</ThemedText>{result.detail.statusHistory.length ? [...result.detail.statusHistory].sort((a, b) => a.version - b.version).map(entry => <Notice key={entry.version}>{tripLabels[entry.toStatus]} · {driverDate(entry.occurredAt)} · {actorLabels[entry.actorType]}</Notice>) : <Notice>Máy chủ chưa cung cấp diễn biến chuyến.</Notice>}</Card>
      {isTerminal(result.detail.trip) && <RebookAction trip={result.detail.trip}/>}
    </>}
  </Screen>;
}
function fareLabel(code: string) {return ({BASE_FARE: 'Giá mở cửa', DISTANCE_FARE: 'Chi phí quãng đường'} as Record<string, string>)[code] || 'Thành phần chi phí';}
