import AppTabs from '@/components/app-tabs';
import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {Redirect} from 'expo-router';
import {randomUUID} from 'expo-crypto';
import {ThemedText} from '@/components/themed-text';
import {Action,Busy,Card,Notice,Screen} from '../driver/components/ui';
import {activeTrip,trip,tripPage,tripDetail} from '../driver/contracts/decode';
import {isTerminal,type Trip,type TripDetail} from '../driver/contracts/models';
import {id} from '../backend/http';
import {point,quote as decodeQuote,type Quote} from '../backend/clients';
import {DurableCommand,type Command} from '../backend/durable-command';
import {commandStorage} from '../backend/command-storage';
import {useCustomer,useCustomerSession} from './provider';
import {CustomerAccount} from './account';
import {useForeground} from '../driver/hooks/use-focused-resource';
import {Avatar} from '../ui/avatar';
import {View,Pressable} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {Chip,palette,vnd,distance,duration} from '../ui/design';
import {RideMap} from '../map/ride-map';
import {decodePolyline} from '../map/polyline';

import {TripCard,tripLabels} from '../driver/components/trip-card';

export function CustomerHome(){
  const state=useCustomerSession();if(state.restoring)return <Screen title="Customer"><Busy visible/></Screen>;
  if(!state.session)return <Redirect href="/customer/login"/>;
  return <Booking key={state.session.profile.id} actorId={state.session.profile.id} name={state.session.profile.fullName}/>;
}
function Booking({actorId,name}:{actorId:string;name:string}){
  const runtime=useCustomer();
  const foreground=useForeground(),read=useRef({busy:false,revision:0});
  const commands=useMemo(()=>new DurableCommand(commandStorage('customer',runtime.base,actorId)),[actorId,runtime.base]);
  const command=useSyncExternalStore(commands.subscribe,commands.getSnapshot,commands.getSnapshot);
  const [coords,setCoords]=useState(['21.0285','105.8542','21.0272','105.8355']);
  const [vehicle,setVehicle]=useState<'CAR_4'|'CAR_7'>('CAR_4'),[quote,setQuote]=useState<Quote|null>(null),[current,setCurrent]=useState<Trip|null>(null),[history,setHistory]=useState<Trip[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(()=>Date.now());
  const [checked,setChecked]=useState(false),[detail,setDetail]=useState<TripDetail|null>(null),[tab,setTab]=useState<'home'|'history'|'account'>('home'),[clockOffset,setClockOffset]=useState(0),[selecting,setSelecting]=useState<'pickup'|'destination'>('destination'),[line,setLine]=useState<[number,number][]|undefined>();
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    if(read.current.busy||signal?.aborted)return;read.current.busy=true;const revision=read.current.revision;
    try{const r=await runtime.session.authorized(t=>runtime.trips.active(t,signal));if(!signal?.aborted&&revision===read.current.revision){const next=activeTrip(r.data);setCurrent(previous=>previous&&next&&previous.tripId===next.tripId&&previous.version>next.version?previous:next);setChecked(true)}}catch(e){if(!signal?.aborted&&revision===read.current.revision)setError(e instanceof Error?e.message:'Không đọc được chuyến')}finally{read.current.busy=false}
  },[runtime]);
  useEffect(()=>runtime.events.subscribe(()=>{void refresh()}),[runtime,refresh]);
  useEffect(()=>{void commands.restore().catch(e=>setError(String(e)))},[commands]);
  useEffect(()=>{if(!foreground)return;const c=new AbortController();void Promise.resolve().then(()=>refresh(c.signal));const timer=setInterval(()=>{void refresh(c.signal)},5000),clock=setInterval(()=>setNow(Date.now()),1000);return()=>{c.abort();clearInterval(timer);clearInterval(clock)}},[foreground,refresh]);
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work()}catch(e){setError(e instanceof Error?e.message:'Không thực hiện được')}finally{setBusy(false)}};
  const estimate=()=>run(async()=>{
    setQuote(null);const pickup=point({lat:Number(coords[0]),lng:Number(coords[1])}),destination=point({lat:Number(coords[2]),lng:Number(coords[3])});
    const r=await runtime.session.authorized(t=>runtime.trips.estimate(t,pickup,destination,vehicle));setClockOffset(r.serverDate===null?0:r.serverDate-Date.now());setQuote(decodeQuote(r.data));
    try{const preview=await runtime.session.authorized(t=>runtime.routes.route(t,pickup,destination,vehicle));const data=preview.data as {polyline:{value:string}};setLine(decodePolyline(data.polyline.value))}catch{setLine(undefined)}
  });
  const execute=(c:Command)=>run(async()=>{
    const r=await commands.run(c,async cmd=>runtime.session.authorized(t=>{
      if(cmd.operation==='create')return runtime.trips.create(t,id(cmd.body.quoteId),cmd.key);
      if(cmd.operation==='cancel'&&typeof cmd.body.version==='number'&&typeof cmd.body.reason==='string')return runtime.trips.cancel(t,id(cmd.body.tripId),cmd.body.version,cmd.body.reason,cmd.key);
      throw new Error('INVALID_COMMAND');
    }));read.current.revision++;setCurrent(trip(r.data));setQuote(null);await refresh();
  });
  const loadHistory=(more:boolean)=>run(async()=>{
    const r=await runtime.session.authorized(t=>runtime.trips.history(t,more?cursor??undefined:undefined)),page=tripPage(r.data);setHistory(old=>more?[...old,...page.items.filter(t=>!old.some(p=>p.tripId===t.tripId))]:page.items);setCursor(page.nextCursor);
  });
  const locked=busy||command.busy||!command.ready||!!command.pending||!checked||!!current&&!isTerminal(current);
  const mapPickup=point({lat:Number(coords[0]),lng:Number(coords[1])}),mapDestination=point({lat:Number(coords[2]),lng:Number(coords[3])});
  return <View style={{flex:1,backgroundColor:palette.surface}}><Screen title={tab==='home'?'Bạn muốn đi đâu?':tab==='history'?'Lịch sử chuyến đi':'Tài khoản của bạn'}>
    {tab==='home'&&<>
      <Notice>Xin chào {name}. Cùng Velox khám phá Hà Nội.</Notice>
      <RideMap pickup={current?.pickup??mapPickup} destination={current?.destination??mapDestination} line={line} onSelect={locked?undefined:p=>{setCoords(old=>selecting==='pickup'?[String(p.lat),String(p.lng),old[2],old[3]]:[old[0],old[1],String(p.lat),String(p.lng)]);setQuote(null);setLine(undefined)}} height={300}/>
      {!current&&<Card><View style={{flexDirection:'row',gap:12}}><Pressable accessibilityRole="button" style={{flex:1,padding:12,borderRadius:18,backgroundColor:selecting==='pickup'?palette.container:palette.surface}} disabled={locked} onPress={()=>setSelecting('pickup')}><Ionicons name="radio-button-on" size={18} color={palette.primary}/><ThemedText type="smallBold">Điểm đón</ThemedText><Notice>{mapPickup.lat.toFixed(5)}, {mapPickup.lng.toFixed(5)}</Notice></Pressable><Pressable accessibilityRole="button" style={{flex:1,padding:12,borderRadius:18,backgroundColor:selecting==='destination'?palette.container:palette.surface}} disabled={locked} onPress={()=>setSelecting('destination')}><Ionicons name="location" size={18} color={palette.ink}/><ThemedText type="smallBold">Điểm đến</ThemedText><Notice>{mapDestination.lat.toFixed(5)}, {mapDestination.lng.toFixed(5)}</Notice></Pressable></View>
        <Action label="Chọn địa chỉ đã lưu" variant="secondary" disabled={locked} onPress={()=>setTab('account')}/>
        <ThemedText type="smallBold">Chọn xe phù hợp với bạn</ThemedText><View style={{flexDirection:'row',gap:12}}>{(['CAR_4','CAR_7'] as const).map(v=><Pressable accessibilityRole="button" key={v} disabled={locked} onPress={()=>{setVehicle(v);setQuote(null);setLine(undefined)}} style={{flex:1,padding:18,borderRadius:20,borderWidth:2,borderColor:v===vehicle?palette.primary:palette.line,backgroundColor:v===vehicle?palette.container:'white'}}><Ionicons name={v==='CAR_4'?'car-sport':'car'} size={32} color={palette.primary}/><ThemedText type="smallBold">{v==='CAR_4'?'Standard':'XL'}</ThemedText><Notice>{v==='CAR_4'?'Ô tô 4 chỗ':'Ô tô 7 chỗ'}</Notice></Pressable>)}</View>
        {quote?<><ThemedText type="subtitle">{vnd(quote.amount)}</ThemedText><Notice>{distance(quote.distance)} · {duration(quote.duration)}</Notice><Chip>Giữ giá còn {Math.max(0,Math.ceil((Date.parse(quote.expiresAt)-now-clockOffset)/1000))} giây</Chip><Action label="Xác nhận đặt xe →" disabled={locked||Date.parse(quote.expiresAt)<=now+clockOffset} onPress={()=>{void execute({key:randomUUID(),operation:'create',body:{quoteId:quote.quoteId}})}}/></>:<Action label="Xem giá chuyến đi →" disabled={locked} onPress={()=>{void estimate()}}/>}
      </Card>}
      {current&&<Card><Chip tone={current.status==='SEARCHING'?'warning':current.status==='CANCELLED'?'danger':'default'}>{tripLabels[current.status]}</Chip><ThemedText type="subtitle">{vnd(current.fare.finalAmount??current.fare.estimatedAmount)}</ThemedText><>{current.driver&&<View style={{flexDirection:"row",gap:14,alignItems:"center"}}><Avatar name={current.driver.fullName} url={current.driver.avatarUrl}/><View><ThemedText type="smallBold">{current.driver.fullName}</ThemedText><Notice>{current.vehicle?.licensePlate} ? {current.vehicle?.brand}</Notice></View></View>}</><Notice>{current.vehicleType==='CAR_7'?'Ô tô 7 chỗ':'Ô tô 4 chỗ'}</Notice>{current.status==='SEARCHING'?<Notice>Chúng tôi đang tìm tài xế phù hợp. Bạn có thể hủy bất cứ lúc nào trước khi bắt đầu.</Notice>:<Notice>Trạng thái chuyến được cập nhật khi tài xế xác nhận.</Notice>}
        {!['IN_PROGRESS','COMPLETED','CANCELLED'].includes(current.status)&&<Action label="Hủy chuyến · không mất phí" variant="secondary" disabled={busy||command.busy||!!command.pending||!command.ready} onPress={()=>{void execute({key:randomUUID(),operation:'cancel',body:{tripId:current.tripId,version:current.version,reason:'Khách hủy trên app'}})}}/>}
      </Card>}
      {command.pending&&<Card><Notice>Đang chờ xác nhận thao tác trước đó. Bạn có thể thử lại an toàn.</Notice><Action label="Thử lại thao tác" disabled={busy||command.busy} onPress={()=>{void execute(command.pending!)}}/></Card>}
      <Action label="Cập nhật chuyến" variant="secondary" disabled={busy} onPress={()=>{void refresh()}}/>
    </>}
    {tab==='history'&&<><Notice>Những hành trình của bạn, trong một nơi.</Notice><Action variant="secondary" label="Cập nhật lịch sử" disabled={busy} onPress={()=>{void loadHistory(false)}}/>{history.length===0&&!busy&&<Card><Ionicons name="receipt-outline" size={36} color={palette.primary}/><ThemedText>Bạn chưa có chuyến nào.</ThemedText><Notice>Chuyến hoàn thành và chuyến đã hủy sẽ hiện ở đây.</Notice></Card>}{history.map(t=><Pressable key={t.tripId} accessibilityRole="button" onPress={()=>{void run(async()=>{const r=await runtime.session.authorized(token=>runtime.trips.detail(token,t.tripId));setDetail(tripDetail(r.data))})}}><TripCard trip={t}/></Pressable>)}{cursor&&<Action variant="secondary" label="Xem thêm chuyến" disabled={busy} onPress={()=>{void loadHistory(true)}}/>}{detail&&<Card><ThemedText type="smallBold">Chi tiết hành trình</ThemedText><TripCard trip={detail.trip}/>{detail.statusHistory.map(h=><Notice key={h.version}>{tripLabels[h.toStatus]} · {new Date(h.occurredAt).toLocaleString('vi-VN')}</Notice>)}<Action variant="secondary" label="Đóng chi tiết" onPress={()=>setDetail(null)}/></Card>}</>}
    {tab==='account'&&<><CustomerAccount select={(p,kind)=>{setCoords(old=>kind==='pickup'?[String(p.lat),String(p.lng),old[2],old[3]]:[old[0],old[1],String(p.lat),String(p.lng)]);setQuote(null);setLine(undefined);setTab('home')}}/><Action variant="secondary" label="Đăng xuất" disabled={busy||command.busy} onPress={()=>{void run(()=>runtime.session.logout())}}/></>}
    <Busy visible={busy||command.busy}/>{!!error&&<Notice>{error}</Notice>}
  </Screen><AppTabs value={tab} onChange={value=>{setTab(value as typeof tab);if(value==='history')void loadHistory(false)}}/></View>;
}
