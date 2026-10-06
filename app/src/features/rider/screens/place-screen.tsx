import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Banner, Card, Icon, Loading, PrimaryButton, SecondaryButton, TextField, Txt, colors, space } from '@/design';
import { RideMap } from '../../map/ride-map';
import { MAP_DEFAULT_CENTER } from '../../map/config';
import type { LatLng } from '../../navigation/geo';
import { RiderScreen } from '../components/rider-screen';
import { PlaceRow, SavedPlaces } from '../components/saved-places';
import { RiderError, errorText } from '../errors';
import { formatCoordinates } from '../format';
import type { GeoPlace } from '../geocoder';
import { currentPosition, describePoint, toPlace } from '../hooks';
import type { Place } from '../models';
import { useRider } from '../provider';
import { useStore } from '../store';

type Target = 'pickup' | 'destination' | 'address';
const TITLES: Record<Target, string> = { pickup: 'Chọn điểm đón', destination: 'Chọn điểm đến', address: 'Chọn vị trí địa chỉ' };

/** Chọn điểm: tìm kiếm (nếu bật Photon), vị trí hiện tại, địa chỉ đã lưu hoặc kéo bản đồ đặt ghim. */
export function PlaceScreen() {
  const params = useLocalSearchParams<{ target?: string }>();
  const target: Target = params.target === 'pickup' || params.target === 'address' ? params.target : 'destination';
  const { booking, account, geocoder } = useRider();
  const bookingState = useStore(booking);
  const draft = useStore(account).draftPlace;
  const anchor: LatLng | null = (target === 'pickup' ? bookingState.pickup : target === 'destination' ? bookingState.destination : draft)
    ?? bookingState.pickup ?? null;
  const [mode, setMode] = useState<'list' | 'map'>('list');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [center, setCenter] = useState<LatLng>(anchor ?? MAP_DEFAULT_CENTER);
  const [centerLabel, setCenterLabel] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const choose = (place: Place, fromGps = false) => {
    if (target === 'pickup') booking.setPickup(place, fromGps);
    else if (target === 'destination') booking.setDestination(place);
    else account.setDraftPlace(place);
    if (router.canGoBack()) router.back(); else router.replace('/');
  };

  useEffect(() => {
    const text = query.trim();
    if (!geocoder || text.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      setError(null);
      geocoder.search(text, anchor, controller.signal)
        .then(setResults)
        .catch((failure: unknown) => { if (!(failure instanceof RiderError && failure.code === 'CANCELLED')) setError(failure); })
        .finally(() => setSearching(false));
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, geocoder, anchor]);

  useEffect(() => {
    if (mode !== 'map') return;
    let cancelled = false;
    setCenterLabel(null);
    const timer = setTimeout(() => {
      void describePoint(center, geocoder).then((label) => { if (!cancelled) setCenterLabel(label); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [center, mode, geocoder]);

  const pickCurrentLocation = async () => {
    setLocating(true);
    setError(null);
    try {
      const point = await currentPosition();
      choose(toPlace(point, await describePoint(point, geocoder)), target === 'pickup');
    } catch (failure) {
      setError(failure);
    } finally {
      setLocating(false);
    }
  };

  if (mode === 'map') {
    return (
      <RiderScreen title={TITLES[target]} scroll={false}
        footer={(
          <>
            <Card style={styles.pinCard}>
              <Icon name="pin_drop" size={20} color={colors.primary} />
              <View style={styles.flex}>
                <Txt variant="title-md" numberOfLines={2}>{centerLabel ?? 'Đang xác định địa chỉ…'}</Txt>
                <Txt variant="body-sm" tabular color={colors.slateMuted}>{formatCoordinates(center.lat, center.lng)}</Txt>
              </View>
            </Card>
            <PrimaryButton label="Chọn điểm này" icon="check" onPress={() => choose(toPlace(center, centerLabel ?? formatCoordinates(center.lat, center.lng)))} />
            <SecondaryButton label="Quay lại danh sách" onPress={() => setMode('list')} />
          </>
        )}>
        <RideMap style={styles.flex} pickMode initialCenter={center} initialZoom={16} onCenterChange={setCenter} />
      </RiderScreen>
    );
  }

  return (
    <RiderScreen title={TITLES[target]}>
      {geocoder ? (
        <TextField label="Tìm địa điểm" value={query} onChangeText={setQuery} placeholder="Tên đường, toà nhà, địa danh…" autoFocus
          returnKeyType="search" autoCorrect={false} trailing={<Icon name="search" size={20} color={colors.slateMuted} style={styles.searchIcon} />} />
      ) : (
        <Banner tone="info" message="Chưa bật tìm kiếm địa điểm (EXPO_PUBLIC_GEOCODER_URL). Hãy chọn trên bản đồ hoặc dùng địa chỉ đã lưu." />
      )}
      {error ? <Banner tone="error" message={errorText(error)} /> : null}
      <PlaceRow icon="my_location" title={locating ? 'Đang lấy vị trí…' : 'Vị trí hiện tại'} subtitle="Dùng GPS của thiết bị" onPress={() => { void pickCurrentLocation(); }} />
      <PlaceRow icon="map" title="Chọn trên bản đồ" subtitle="Kéo bản đồ để đặt ghim" onPress={() => setMode('map')} />
      {searching ? <Loading label="Đang tìm…" /> : null}
      {results.map((place) => (
        <PlaceRow key={place.id} icon="location_on" title={place.title} subtitle={place.subtitle}
          onPress={() => choose(toPlace({ lat: place.lat, lng: place.lng }, place.subtitle ? `${place.title}, ${place.subtitle}` : place.title))} />
      ))}
      {!searching && geocoder && query.trim().length >= 2 && !results.length && !error ? (
        <Txt variant="body-sm" color={colors.slateMuted}>Không tìm thấy địa điểm phù hợp.</Txt>
      ) : null}
      {target !== 'address' ? (
        <SavedPlaces onPick={(address) => choose({ lat: address.lat, lng: address.lng, address: address.addressText })} />
      ) : null}
    </RiderScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pinCard: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  searchIcon: { marginRight: space.sm },
});
