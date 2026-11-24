import {router} from 'expo-router';
import {View} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import type {Trip} from '../driver/contracts/models';
import {Card, Action, Notice} from '../ui/components';
import {Chip, palette, vnd} from '../ui/design';
import {driverDate, vehicleLabel} from '../driver/presentation/format';
import {Avatar} from '../ui/avatar';
import {tripPresentation} from './trip-policy';
import {RebookAction} from './rebook-action';

export function CustomerHistoryCard({trip}: {trip: Trip}) {
  return <Card>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between'}}>
      <ThemedText type="smallBold">{vehicleLabel(trip.vehicleType)}</ThemedText>
      <Chip tone={trip.status === 'CANCELLED' ? 'danger' : 'default'}>{tripPresentation(trip).title}</Chip>
    </View>
    <Notice>{driverDate(trip.timestamps?.requestedAt)}</Notice>
    <View style={{borderLeftWidth: 3, borderLeftColor: palette.primary, paddingLeft: 12, gap: 8}}>
      <ThemedText type="smallBold">Đón: {trip.pickup.address || `${trip.pickup.lat}, ${trip.pickup.lng}`}</ThemedText>
      <ThemedText>Đến: {trip.destination.address || `${trip.destination.lat}, ${trip.destination.lng}`}</ThemedText>
    </View>
    <ThemedText type="subtitle">{vnd(trip.fare.finalAmount ?? trip.fare.estimatedAmount)}</ThemedText>
    <Notice>{trip.fare.finalAmount === null ? 'Giá dự kiến' : 'Giá chốt chuyến đi'}</Notice>
    {!!trip.driver?.fullName && <View style={{flexDirection: 'row', gap: 12, alignItems: 'center'}}><Avatar name={trip.driver.fullName} url={trip.driver.avatarUrl}/><View style={{flex: 1}}><ThemedText>{trip.driver.fullName}</ThemedText><Notice>{trip.vehicle?.licensePlate || 'Chưa có biển số'}</Notice></View></View>}
    <Action label="Xem chi tiết chuyến" variant="secondary" onPress={() => router.push({pathname: '/customer/trips/[id]', params: {id: trip.tripId}})}/>
    <RebookAction trip={trip}/>
  </Card>;
}
