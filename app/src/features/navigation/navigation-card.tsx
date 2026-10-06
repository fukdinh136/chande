import {useEffect,useState} from 'react';
import {View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {Navigation,type Progress} from './native';
import {useDriverRuntime} from '../driver/state/driver-provider';
import type {Trip} from '../driver/contracts/models';
import {PreviewApi} from '../backend/clients';
import {BackendHttp,record} from '../backend/http';
import {currentLocation,useLocation} from '../map/location-store';
import {RideMap} from '../map/ride-map';
import {decodePolyline} from '../map/polyline';
import {Card,Notice} from '../driver/components/ui';
import {ThemedText} from '@/components/themed-text';
import {distance,duration,palette} from '../ui/design';
import {useForeground} from '../driver/hooks/use-focused-resource';
import {instruction as describeManeuver} from './instruction';
export function NavigationCard({trip}:{trip:Trip}){
  const runtime=useDriverRuntime(),position=useLocation(),foreground=useForeground();
  const [progress,setProgress]=useState<Progress|null>(null),[line,setLine]=useState<[number,number][]|undefined>(),[error,setError]=useState('');
  const ready=!!position&&position.accuracy<=100;
  const target=trip.status==='IN_PROGRESS'?trip.destination:trip.pickup,phase=trip.status;
  useEffect(()=>{
    if(!ready||!foreground||!['ASSIGNED','IN_PROGRESS'].includes(phase))return;
    const control=new AbortController();let revision=0,busy=false,last=0,session='',pendingReroute=false;let delayed:ReturnType<typeof setTimeout>|undefined;
    const fetchRoute=async()=>{
      if(busy||control.signal.aborted||Date.now()-last<5000)return;const sample=currentLocation();if(!sample||sample.accuracy>100||Date.now()-sample.timestamp>30000)return;
      busy=true;last=Date.now();const expected=++revision;
      try{
        const api=new PreviewApi(new BackendHttp(runtime.config.gatewayBase??runtime.config.driverBase));
        const result=await api.navigation(await runtime.session.accessToken(control.signal),sample,{lat:target.lat,lng:target.lng},trip.vehicleType,control.signal);
        if(control.signal.aborted||revision!==expected)return;
        const data=record(result.data),route=record(data.route);if(data.schemaVersion!==1||data.geometryPrecision!==6||typeof route.geometry!=='string')throw Error('INVALID_NAVIGATION_ROUTE');
        const coordinates=decodePolyline(route.geometry);session=`${trip.tripId}/${phase}/${revision}`;
        if(!Navigation)throw Error('Navigation SDK chưa có trong bản cài này.');
        Navigation.start(JSON.stringify(route),session);Navigation.pushLocation(sample.lat,sample.lng,sample.accuracy,sample.timestamp,sample.speed,sample.heading);
        setLine(coordinates);setProgress(null);setError('');pendingReroute=false;
      }catch(e){if(!control.signal.aborted)setError(e instanceof Error?e.message:'Chưa tính được đường đi')}finally{busy=false}
    };
    const a=Navigation?.addListener('progress',p=>{if(!control.signal.aborted&&p.sessionId===session)setProgress(p)}),b=Navigation?.addListener('offRoute',p=>{if(p.sessionId===session){pendingReroute=true;if(!delayed)delayed=setTimeout(()=>{delayed=undefined;void fetchRoute()},Math.max(0,5000-(Date.now()-last)))}});
    void fetchRoute();const retry=setInterval(()=>{if(!session||pendingReroute)void fetchRoute()},10000);
    return()=>{control.abort();revision++;clearInterval(retry);if(delayed)clearTimeout(delayed);a?.remove();b?.remove();Navigation?.stop()};
  },[runtime,trip.tripId,trip.vehicleType,phase,target.lat,target.lng,ready,foreground]);
  if(!['ASSIGNED','IN_PROGRESS'].includes(phase))return <><Notice>{phase==='DRIVER_ARRIVED'?'Đã đến điểm đón. Chờ khách và xác nhận bắt đầu.':'Chuyến đã kết thúc.'}</Notice><RideMap pickup={trip.pickup} destination={trip.destination} position={position} height={240}/></>;
  const instruction=progress?describeManeuver(progress.maneuver,progress.modifier,progress.street):phase==='IN_PROGRESS'?'Đi đến điểm trả khách':'Đi đến điểm đón khách';
  return <><Card><View style={{flexDirection:'row',gap:14,alignItems:'center'}}><Ionicons name={progress?.modifier==='left'?'arrow-back':progress?.modifier==='right'?'arrow-forward':'navigate'} size={32} color={palette.primary}/><View style={{flex:1}}><ThemedText type="smallBold">{instruction}</ThemedText>{progress?<Notice>{distance(progress.distanceToManeuverMeters)} đến chỉ dẫn tiếp theo</Notice>:<Notice>{ready?'Đang khởi tạo điều hướng':'Bật GPS và chờ vị trí chính xác để điều hướng'}</Notice>}</View></View>{progress&&<ThemedText>{duration(progress.remainingDurationSeconds)} · {distance(progress.remainingDistanceMeters)}</ThemedText>}{progress&&progress.remainingDistanceMeters<40&&<Notice>Đã gần điểm đến. Xác nhận trạng thái chuyến bằng nút bên dưới.</Notice>}{error&&<Notice>{error}</Notice>}</Card><RideMap pickup={trip.pickup} destination={trip.destination} position={position} line={line} follow height={280}/></>;
}
