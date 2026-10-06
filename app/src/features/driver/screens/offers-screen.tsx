import {useCallback,useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {randomUUID} from 'expo-crypto';
import {router} from 'expo-router';
import {ThemedText} from '@/components/themed-text';
import {useDriverRuntime,useDriverSession} from '../state/driver-provider';
import {useFocusedResource} from '../hooks/use-focused-resource';
import {Action,Busy,Card,ErrorNotice,Notice,Screen} from '../components/ui';
import {DurableCommand,type Command} from '../../backend/durable-command';
import {commandStorage} from '../../backend/command-storage';
import {id} from '../../backend/http';
export function OffersScreen(){
  const runtime=useDriverRuntime(),session=useDriverSession(),resource=useFocusedResource(useCallback((signal:AbortSignal)=>runtime.matching.active(signal),[runtime]),!!session.session,5000);
  const actorId=session.session?.driver.driverId;
  const manager=useMemo(()=>new DurableCommand(commandStorage('driver',runtime.config.driverBase,actorId!)),[runtime,actorId]);
  const command=useSyncExternalStore(manager.subscribe,manager.getSnapshot,manager.getSnapshot),pending=command.pending,busy=command.busy;
  const [error,setError]=useState<unknown>(null),[now,setNow]=useState(()=>Date.now());
  useEffect(()=>{void manager.restore().catch(setError)},[manager]);
  const refresh=resource.refresh;
  useEffect(()=>runtime.realtime.subscribe(()=>refresh()),[runtime.realtime,refresh]);
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[]);
  const current=resource.data,remaining=current?Math.max(0,Math.ceil((Date.parse(current.expiresAt)-now)/1000)):0;
  const submit=async(decision:Command)=>{setError(null);try{await manager.run(decision,async c=>{if(c.operation!=='accept'&&c.operation!=='decline')throw Error('INVALID_COMMAND');await runtime.matching[c.operation](id(c.body.offerId),c.key)});resource.refresh();if(decision.operation==='accept')router.push('/driver/trip')}catch(e){setError(e);resource.refresh()}};
  return <Screen title="Lời mời chuyến" backToDriver>
    <Action label="Đọc lại lời mời" onPress={resource.refresh} disabled={resource.loading||busy}/>
    <Busy visible={resource.loading||busy}/><ErrorNotice error={error??resource.error}/>
    {!runtime.matching.available?<Notice>{runtime.matching.reason}</Notice>:current?<Card>
      <ThemedText>Chuyến {current.tripId}</ThemedText><Notice>{current.vehicleType} · Giá chuyến {current.fare.amount} VND</Notice>
      <Notice>Đón: {current.pickup.address??`${current.pickup.lat}, ${current.pickup.lng}`}</Notice><Notice>Đến: {current.destination.address??`${current.destination.lat}, ${current.destination.lng}`}</Notice>
      <Notice>{current.status==='PENDING'?`Còn khoảng ${remaining}s; server quyết định hạn lời mời.`:current.status==='ASSIGNMENT_PENDING'?'Đang xác nhận gán chuyến. Chưa được coi là đã nhận cuốc.':`Trạng thái: ${current.status}`}</Notice>
      {current.status==='PENDING'&&<><Action label="Nhận cuốc" disabled={busy||!command.ready||!!pending||!remaining} onPress={()=>{void submit({body:{offerId:current.offerId},key:randomUUID(),operation:'accept'})}}/><Action label="Bỏ qua" disabled={busy||!command.ready||!!pending||!remaining} onPress={()=>{void submit({body:{offerId:current.offerId},key:randomUUID(),operation:'decline'})}}/></>}
      {current.status!=='PENDING'&&<Action label="Xem chuyến hiện tại" onPress={()=>router.push('/driver/trip')}/>}</Card>:resource.checkedAt&&!resource.error?<Notice>Hiện không có lời mời. Bật ONLINE, chọn xe và gửi GPS mới để backend tìm được tài xế.</Notice>:null}
    {pending&&<><Notice>Chưa rõ kết quả quyết định. Retry giữ cùng Idempotency-Key; không gửi hành động khác.</Notice><Action label="Thử lại quyết định cũ" disabled={busy} onPress={()=>{void submit(pending)}}/></>}
    <Notice>Accept HTTP202 chỉ lưu quyết định. Trip ASSIGNED mới xác nhận nhận chuyến; thời gian chờ callback không reset hạn20s.</Notice>
  </Screen>;
}
