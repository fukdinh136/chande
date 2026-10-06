import {useEffect,useState} from 'react';
import {Action,Busy,Card,Field,Notice} from '../driver/components/ui';
import {record,id} from '../backend/http';
import {point,type Point} from '../backend/clients';
import {useCustomer,useCustomerSession} from './provider';
interface Place extends Point {id:string;label:string;addressText:string;isDefault:boolean}
function places(value:unknown):Place[]{if(!Array.isArray(value))throw Error('INVALID_RESPONSE');return value.map(v=>{const p=record(v);if(typeof p.label!=='string'||typeof p.addressText!=='string'||typeof p.isDefault!=='boolean')throw Error('INVALID_RESPONSE');return {...point(p),id:id(p.id),label:p.label,addressText:p.addressText,isDefault:p.isDefault}})}
export function CustomerAccount({select}:{select:(p:Point,kind:'pickup'|'destination')=>void}){
  const runtime=useCustomer(),state=useCustomerSession();
  const [name,setName]=useState(state.session?.profile.fullName??''),[items,setItems]=useState<Place[]>([]),[label,setLabel]=useState(''),[address,setAddress]=useState(''),[lat,setLat]=useState(''),[lng,setLng]=useState(''),[editing,setEditing]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{let disposed=false;void runtime.session.authorized(t=>runtime.user.places(t)).then(v=>{if(!disposed)setItems(places(v))}).catch(e=>{if(!disposed)setMessage(String(e))});return()=>{disposed=true}},[runtime]);
  const run=async(work:()=>Promise<unknown>)=>{setBusy(true);setMessage('');try{await work();setItems(places(await runtime.session.authorized(t=>runtime.user.places(t))));setMessage('Đã cập nhật')}catch(e){setMessage(e instanceof Error?e.message:'Không cập nhật được')}finally{setBusy(false)}};
  return <Card><Notice>Hồ sơ và địa chỉ đã lưu</Notice><Field label="Họ tên" value={name} onChangeText={setName}/><Action label="Lưu họ tên" disabled={busy||!name.trim()} onPress={()=>{void run(()=>runtime.session.authorized(t=>runtime.user.updateProfile(t,{fullName:name.trim()})))}}/>
    {items.map(p=><Card key={p.id}><Notice>{p.label} · {p.addressText}{p.isDefault?' · Mặc định':''}</Notice><Action label="Dùng làm điểm đón" disabled={busy} onPress={()=>select(p,'pickup')}/><Action label="Dùng làm điểm đến" disabled={busy} onPress={()=>select(p,'destination')}/><Action label="Sửa địa chỉ" disabled={busy} onPress={()=>{setEditing(p.id);setLabel(p.label);setAddress(p.addressText);setLat(String(p.lat));setLng(String(p.lng))}}/><Action label="Đặt mặc định" disabled={busy||p.isDefault} onPress={()=>{void run(()=>runtime.session.authorized(t=>runtime.user.defaultPlace(t,p.id)))}}/><Action label="Xóa địa chỉ" disabled={busy} onPress={()=>{void run(()=>runtime.session.authorized(t=>runtime.user.deletePlace(t,p.id)))}}/></Card>)}
    <Field label="Nhãn địa chỉ" value={label} onChangeText={setLabel}/><Field label="Địa chỉ" value={address} onChangeText={setAddress}/><Field label="Vĩ độ địa chỉ" value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation"/><Field label="Kinh độ địa chỉ" value={lng} onChangeText={setLng} keyboardType="numbers-and-punctuation"/>
    <Action label={editing?'Lưu địa chỉ đã sửa':'Thêm địa chỉ'} disabled={busy||!label.trim()||!address.trim()||!lat.trim()||!lng.trim()} onPress={()=>{void run(async()=>{const p=point({lat:Number(lat),lng:Number(lng)}),body={label:label.trim(),addressText:address.trim(),lat:p.lat,lng:p.lng,makeDefault:false};await runtime.session.authorized(t=>editing?runtime.user.updatePlace(t,editing,body):runtime.user.createPlace(t,body));setEditing(null);setLabel('');setAddress('');setLat('');setLng('')})}}/>
    {editing&&<Action label="Dừng sửa" disabled={busy} onPress={()=>setEditing(null)}/>}<Busy visible={busy}/><Notice>{message}</Notice>
  </Card>;
}
