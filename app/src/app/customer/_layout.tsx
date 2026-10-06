import {Stack} from 'expo-router';import {CustomerProvider} from '@/features/customer/provider';
export default function CustomerLayout(){return <CustomerProvider><Stack screenOptions={{title:'Velox Customer'}}/></CustomerProvider>}
