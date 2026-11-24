import {Stack} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {CustomerProvider} from '@/features/customer/provider';

export default function CustomerLayout(){return <CustomerProvider><StatusBar style="dark"/><Stack screenOptions={{headerShown:false}}/></CustomerProvider>}
