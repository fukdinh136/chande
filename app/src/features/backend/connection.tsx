import {useState} from 'react';
import * as SecureStore from 'expo-secure-store';
import {reloadAppAsync} from 'expo';
import {Platform} from 'react-native';
import {origin} from './http';
import {Action,Field,Notice,Card} from '../driver/components/ui';
const key='chande.gateway.origin';let memory:string|null=null;
export async function gatewayOrigin(){return (Platform.OS==='web'?memory:await SecureStore.getItemAsync(key))??process.env.EXPO_PUBLIC_BACKEND_ORIGIN}
export function ConnectionSettings(){
  const [opened,setOpened]=useState(false),[url,setUrl]=useState(process.env.EXPO_PUBLIC_BACKEND_ORIGIN??'http://10.0.2.2:18080'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  if(!opened)return <Action label="Cấu hình máy chủ" variant="secondary" onPress={()=>{setOpened(true);void gatewayOrigin().then(value=>{if(value)setUrl(value)})}}/>;
  return <Card><Notice>Emulator dùng 10.0.2.2. Máy thật dùng IP máy chạy backend hoặc localhost qua USB adb reverse.</Notice><Field label="Địa chỉ Gateway" value={url} onChangeText={setUrl} keyboardType="url" autoCapitalize="none"/><Action label="Lưu và kết nối lại" disabled={busy} onPress={()=>{setBusy(true);setError('');void(async()=>{const value=origin(url.trim(),__DEV__||process.env.EXPO_PUBLIC_LOCAL_DEMO==='true');if(Platform.OS==='web'){memory=value;window.location.reload()}else{await SecureStore.setItemAsync(key,value);await reloadAppAsync()}})().catch(e=>{setError(e instanceof Error?e.message:'Địa chỉ chưa hợp lệ');setBusy(false)})}}/><Notice>{error}</Notice><Action label="Đóng" variant="secondary" disabled={busy} onPress={()=>setOpened(false)}/></Card>;
}
