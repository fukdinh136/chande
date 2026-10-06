import {ConnectionSettings} from '../backend/connection';
import {useState} from 'react';import {Redirect} from 'expo-router';
import {useCustomer,useCustomerSession} from './provider';
import {Action,Busy,Field,Notice,Screen} from '../driver/components/ui';
export function CustomerLogin(){
  const runtime=useCustomer(),state=useCustomerSession();const [phone,setPhone]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[register,setRegister]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  if(state.restoring)return <Screen title="Khôi phục Customer"><Busy visible/></Screen>;if(state.session)return <Redirect href="/customer"/>;
  const submit=async()=>{setBusy(true);setMessage('');try{if(register)await runtime.user.register(phone,password,name);await runtime.session.login(phone,password)}catch(e){setMessage(e instanceof Error?e.message:'Không thể đăng nhập')}finally{setBusy(false)}};
  return <Screen title={register?'Đăng ký Customer':'Đăng nhập Customer'}><Notice>Di chuyển dễ dàng. Đăng nhập để bắt đầu hành trình.</Notice><Field label="Số điện thoại" value={phone} onChangeText={setPhone} keyboardType="phone-pad"/>{register&&<Field label="Họ tên" value={name} onChangeText={setName}/>}<Field label="Mật khẩu" value={password} onChangeText={setPassword} secureTextEntry/><Action label={register?'Tạo tài khoản và đăng nhập':'Đăng nhập'} disabled={busy} onPress={()=>{void submit()}}/><Action label={register?'Đã có tài khoản':'Đăng ký'} disabled={busy} onPress={()=>setRegister(v=>!v)}/><ConnectionSettings/><Busy visible={busy}/><Notice>{message||state.error instanceof Error&&state.error.message||''}</Notice></Screen>;
}
