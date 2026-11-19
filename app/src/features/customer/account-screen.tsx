import {useState} from 'react';
import {router} from 'expo-router';
import {Action, Notice, Screen} from '../ui/components';
import {ConnectionSettings} from '../backend/connection';
import {CustomerAccount} from './account';
import {useCustomer} from './provider';
import {useBooking} from './booking-provider';
import {placeLabel} from './places';
import {useOwnedForm} from './use-owned-form';

export function CustomerAccountScreen() {
  const {store, state, command} = useBooking(), runtime = useCustomer();
  const form = useOwnedForm(), [error, setError] = useState('');
  return <Screen title="Tài khoản của bạn">
    <CustomerAccount select={(value, kind) => {
      store.selectKind(kind);
      if (store.proposePoint({lat:value.lat,lng:value.lng,address:value.addressText},placeLabel(value))) {setError(''); router.navigate('/customer');}
      else setError('Chưa thể đổi điểm. Vui lòng kiểm tra chuyến đi hoặc thao tác đang chờ tại Đặt xe.');
    }}/>
    {!!error && <Notice tone="error">{error}</Notice>}
    {!!form.message && <Notice tone="error">{form.message}</Notice>}
    <Action label="Đăng xuất" variant="secondary" busy={form.busy} disabled={state.busy || command.busy} onPress={() => {void form.run(() => runtime.session.logout(), () => {});}}/>
    <ConnectionSettings/>
  </Screen>;
}
