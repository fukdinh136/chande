import {Stack} from 'expo-router';
import {CustomerSessionGate} from '@/features/customer/booking-provider';

export const unstable_settings = {initialRouteName: '(tabs)'};
export default function CustomerAuthenticatedLayout() {
  return <CustomerSessionGate><Stack screenOptions={{headerShown: false}}/></CustomerSessionGate>;
}
