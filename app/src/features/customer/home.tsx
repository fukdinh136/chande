import {useCallback,useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {Redirect} from 'expo-router';
import {randomUUID} from 'expo-crypto';
import {ThemedText} from '@/components/themed-text';
import {Action,Busy,Card,Field,Notice,Screen} from '../driver/components/ui';
import {activeTrip,trip,tripPage} from '../driver/contracts/decode';
import {isTerminal,type Trip} from '../driver/contracts/models';
import {id} from '../backend/http';
import {point,quote as decodeQuote,type Quote} from '../backend/clients';
import {DurableCommand,type Command} from '../backend/durable-command';
import {commandStorage} from '../backend/command-storage';
import {useCustomer,useCustomerSession} from './provider';
import {CustomerAccount} from './account';
export function CustomerHome(){
  const state=useCustomerSession();if(state.restoring)return <Screen title="Customer"><Busy visible/></Screen>;
  if(!state.session)return <Redirect href="/customer/login"/>;
  return <Booking key={state.session.profile.id} actorId={state.session.profile.id} name={state.session.profile.fullName}/>;
}
function Booking({actorId,name}:{actorId:string;name:string}){
  const runtime=useCustomer();
  const commands=useMemo(()=>new DurableCommand(commandStorage('customer',runtime.base,actorId)),[actorId,runtime.base]);
  const command=useSyncExternalStore(commands.subscribe,commands.getSnapshot,commands.getSnapshot);
  const [coords,setCoords]=useState(['21.0285','105.8542','21.0272','105.8355']);
  const [vehicle,setVehicle]=useState<'CAR_4'|'CAR_7'>('CAR_4'),[quote,setQuote]=useState<Quote|null>(null),[current,setCurrent]=useState<Trip|null>(null),[history,setHistory]=useState<Trip[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(()=>Date.now());
  const [checked,setChecked]=useState(false),[detail,setDetail]=useState(''),[account,setAccount]=useState(false);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    try{const r=await runtime.session.authorized(t=>runtime.trips.active(t,signal));if(!signal?.aborted){setCurrent(activeTrip(r.data));setChecked(true)}}catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Không đọc được chuyến')}
  },[runtime]);
  useEffect(()=>runtime.events.subscribe(()=>{void refresh()}),[runtime,refresh]);
  useEffect(()=>{const c=new AbortController();void commands.restore().catch(e=>setError(String(e)));void Promise.resolve().then(()=>refresh(c.signal));const timer=setInterval(()=>{void refresh(c.signal)},5000),clock=setInterval(()=>setNow(Date.now()),1000);return()=>{c.abort();clearInterval(timer);clearInterval(clock)}},[commands,refresh]);
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work()}catch(e){setError(e instanceof Error?e.message:'Không thực hiện được')}finally{setBusy(false)}};
  const estimate=()=>run(async()=>{
    setQuote(null);const pickup=point({lat:Number(coords[0]),lng:Number(coords[1])}),destination=point({lat:Number(coords[2]),lng:Number(coords[3])});
    const r=await runtime.session.authorized(t=>runtime.trips.estimate(t,pickup,destination,vehicle));setQuote(decodeQuote(r.data));
  });
  const execute=(c:Command)=>run(async()=>{
    const r=await commands.run(c,async cmd=>runtime.session.authorized(t=>{
      if(cmd.operation==='create')return runtime.trips.create(t,id(cmd.body.quoteId),cmd.key);
      if(cmd.operation==='cancel'&&typeof cmd.body.version==='number'&&typeof cmd.body.reason==='string')return runtime.trips.cancel(t,id(cmd.body.tripId),cmd.body.version,cmd.body.reason,cmd.key);
      throw new Error('INVALID_COMMAND');
    }));setCurrent(trip(r.data));setQuote(null);await refresh();
  });
  const loadHistory=(more:boolean)=>run(async()=>{
    const r=await runtime.session.authorized(t=>runtime.trips.history(t,more?cursor??undefined:undefined)),page=tripPage(r.data);setHistory(old=>more?[...old,...page.items.filter(t=>!old.some(p=>p.tripId===t.tripId))]:page.items);setCursor(page.nextCursor);
  });
  const locked=busy||command.busy||!command.ready||!!command.pending||!checked||!!current&&!isTerminal(current);
  return <Screen title="Velox · Đặt xe Hà Nội">
    <Action label={account?'Đóng hồ sơ / địa chỉ':'Hồ sơ / địa chỉ đã lưu'} disabled={locked} onPress={()=>setAccount(v=>!v)}/>
    {account&&!locked&&<CustomerAccount select={(p,kind)=>{setCoords(old=>kind==='pickup'?[String(p.lat),String(p.lng),old[2],old[3]]:[old[0],old[1],String(p.lat),String(p.lng)]);setQuote(null);setAccount(false)}}/>}
    <Notice>Xin chào {name}</Notice><Card><ThemedText>Điểm đón → Điểm đến</ThemedText>
      {['Vĩ độ đón','Kinh độ đón','Vĩ độ đến','Kinh độ đến'].map((label,i)=><Field key={label} label={label} value={coords[i]} keyboardType="numbers-and-punctuation" editable={!locked} onChangeText={v=>{setCoords(a=>a.map((s,j)=>j===i?v:s));setQuote(null)}}/>)}
      {(['CAR_4','CAR_7'] as const).map(v=><Action key={v} label={`${v} ${vehicle===v?'✓':''}`} disabled={locked} onPress={()=>{setVehicle(v);setQuote(null)}}/>)}
      <Action label="Ước tính giá" disabled={locked} onPress={()=>{void estimate()}}/><Notice>Địa chỉ hiện chọn bằng tọa độ. BIKE và tìm địa chỉ chờ backend hỗ trợ.</Notice>
      {quote&&<><ThemedText>{quote.amount} VND</ThemedText><Notice>{quote.distance} m · {quote.duration} giây · Quote còn khoảng {Math.max(0,Math.ceil((Date.parse(quote.expiresAt)-now)/1000))}s</Notice><Action label="Đặt xe" disabled={locked||Date.parse(quote.expiresAt)<=now} onPress={()=>{void execute({key:randomUUID(),operation:'create',body:{quoteId:quote.quoteId}})}}/></>}
    </Card>
    {command.pending&&<Card><Notice>Kết quả lệnh {command.pending.operation} chưa rõ. Retry giữ nguyên quote/version và khóa, kể cả quote hết hạn sau lần gửi đầu.</Notice><Action label="Thử lại lệnh đang chờ" disabled={busy||command.busy} onPress={()=>{void execute(command.pending!)}}/></Card>}
    <Action label="Đọc lại chuyến hiện tại" disabled={busy} onPress={()=>{void refresh()}}/>
    {current?<Card><ThemedText>{current.status}</ThemedText><Notice>{current.tripId} · {current.fare.finalAmount??current.fare.estimatedAmount} VND</Notice><Notice>{current.status==='SEARCHING'?'Đang tìm tài xế; không tự hủy khi hết ứng viên.':current.driverId?`Tài xế: ${current.driverId}`:'Chưa gán tài xế'}</Notice>
      {!['IN_PROGRESS','COMPLETED','CANCELLED'].includes(current.status)&&<Action label="Hủy chuyến · không phí hủy" disabled={busy||command.busy||!!command.pending||!command.ready} onPress={()=>{void execute({key:randomUUID(),operation:'cancel',body:{tripId:current.tripId,version:current.version,reason:'Khách hủy trên app'}})}}/>}</Card>:checked?<Notice>Không có chuyến active.</Notice>:<Busy visible/>}
    <Action label="Lịch sử chuyến" disabled={busy} onPress={()=>{void loadHistory(false)}}/>
    {history.map(t=><Card key={t.tripId}><Notice>{t.status} · {t.fare.finalAmount??t.fare.estimatedAmount} VND</Notice><Action label={`Chi tiết ${t.tripId}`} disabled={busy} onPress={()=>{void run(async()=>{const r=await runtime.session.authorized(token=>runtime.trips.detail(token,t.tripId));setDetail(JSON.stringify(r.data,null,2))})}}/></Card>)}
    {cursor&&<Action label="Tải thêm lịch sử" disabled={busy} onPress={()=>{void loadHistory(true)}}/>}{detail&&<Notice>{detail}</Notice>}
    <Action label="Đăng xuất" disabled={busy||command.busy} onPress={()=>{void run(()=>runtime.session.logout())}}/><Busy visible={busy||command.busy}/><Notice>{error}</Notice>
  </Screen>;
}
