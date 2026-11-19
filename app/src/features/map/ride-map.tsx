import {useCallback,useEffect,useRef,useState,useMemo} from 'react';
import {View,Text,StyleSheet,Pressable} from 'react-native';
import {Map,Camera,Marker,GeoJSONSource,Layer,type CameraRef} from '@maplibre/maplibre-react-native';
import {Ionicons} from '@expo/vector-icons';
import type {Point} from '../backend/clients';
import {palette} from '../ui/design';
import {observeTileFailures} from './loading-errors';
export interface RideMapProps {pickup?:Point;destination?:Point;position?:Point|null;line?:[number,number][];onSelect?:(point:Point)=>void;height?:number;follow?:boolean;fitKey?:string;fill?:boolean;candidate?:Point;candidateKind?:'pickup'|'destination';candidateLabel?:string;pickupLabel?:string;destinationLabel?:string;selectionLabel?:string;reportTileErrors?:boolean}
// fitKey opts Driver into fitting trip/phase/route changes. Existing callers keep their camera policy.
export function RideMap({pickup,destination,position,line,onSelect,height=320,follow=false,fitKey,fill=false,candidate,candidateKind,candidateLabel,pickupLabel,destinationLabel,selectionLabel,reportTileErrors=false}:RideMapProps){
  const camera=useRef<CameraRef>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
  const tileFailed=useRef(false);
  useEffect(()=>{if(reportTileErrors)return observeTileFailures(()=>{tileFailed.current=true;setError(true)});},[reportTileErrors]);
  const viewport=useRef({width:320,height});
  const [ready,setReady]=useState(false),latestPosition=useRef(position),fitted=useRef<object|null>(null);
  useEffect(()=>{latestPosition.current=position},[position]);
  const pickupLat=pickup?.lat,pickupLng=pickup?.lng,destinationLat=destination?.lat,destinationLng=destination?.lng;
  const candidateLat=candidate?.lat,candidateLng=candidate?.lng;
  const points=useMemo(()=>{
    if(fitKey===undefined)return null;
    const valid=([lng,lat]:[number,number])=>Number.isFinite(lng)&&Math.abs(lng)<=180&&Number.isFinite(lat)&&Math.abs(lat)<=85.05112878;
    const route=line?.filter(valid);
    return route&&route.length>1?route:([[pickupLng,pickupLat],[destinationLng,destinationLat],[candidateLng,candidateLat]] as [number,number][]).filter(valid);
  },[fitKey,line,pickupLat,pickupLng,destinationLat,destinationLng,candidateLat,candidateLng]);
  const fitDriver=useCallback(()=>{
    if(!points||!camera.current)return;
    const p=latestPosition.current;
    const target=points.length?points:p&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=85.05112878&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180?[[p.lng,p.lat]]:fill?[[105.8542,21.0285]]:[];
    if(!target.length)return;
    let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
    for(const [lng,lat] of target){west=Math.min(west,lng);south=Math.min(south,lat);east=Math.max(east,lng);north=Math.max(north,lat)}
    if(west===east&&south===north)camera.current?.easeTo({center:[west,south],zoom:15,duration:500});
    else camera.current?.fitBounds([west,south,east,north],{padding:fill?{top:Math.min(45,viewport.current.height*0.15),bottom:Math.min(60,viewport.current.height*0.2),left:Math.min(35,viewport.current.width*0.1),right:Math.min(35,viewport.current.width*0.1)}:{top:45,bottom:60,left:35,right:35},duration:600});
    fitted.current=points;
  },[points,fill]);
  const hasPosition=!!position;
  useEffect(()=>{if(ready&&points&&fitted.current!==points&&(points.length||hasPosition))fitDriver()},[ready,points,hasPosition,fitDriver]);
  const routeData=useMemo(()=>line?{type:'Feature' as const,properties:{},geometry:{type:'LineString' as const,coordinates:line}}:undefined,[line]);
  useEffect(()=>{if(fitKey===undefined&&follow&&position)camera.current?.easeTo({center:[position.lng,position.lat],zoom:16,pitch:35,duration:700})},[fitKey,follow,position]);
  useEffect(()=>{if(fitKey===undefined&&line&&line.length>1){const lng=line.map(p=>p[0]),lat=line.map(p=>p[1]);camera.current?.fitBounds([Math.min(...lng),Math.min(...lat),Math.max(...lng),Math.max(...lat)],{padding:{top:45,bottom:60,left:35,right:35},duration:600})}},[fitKey,line]);
  const center:[number,number]=[pickup?.lng??105.8542,pickup?.lat??21.0285];
  return <View onLayout={event=>{viewport.current=event.nativeEvent.layout}} style={[styles.container,fill?{flex:1,borderRadius:0}:{height}]}><Map key={retry} style={styles.map} mapStyle={process.env.EXPO_PUBLIC_MAP_STYLE_URL??'https://tiles.openfreemap.org/styles/liberty'} onPress={e=>onSelect?.({lng:e.nativeEvent.lngLat[0],lat:e.nativeEvent.lngLat[1]})} onDidFinishLoadingMap={()=>{setReady(true);if(!tileFailed.current)setError(false)}} onDidFailLoadingMap={()=>setError(true)}><Camera ref={camera} initialViewState={{center,zoom:14}}/>
    {routeData&&<GeoJSONSource id="route" data={routeData}><Layer id="route-shadow" type="line" paint={{'line-color':'#8be0d6','line-width':11,'line-opacity':0.6}}/><Layer id="route-line" type="line" paint={{'line-color':palette.primary,'line-width':5}}/></GeoJSONSource>}
    {pickup&&<Marker lngLat={[pickup.lng,pickup.lat]} anchor={fill?'top':'center'} offset={fill?[0,-16]:undefined}><View style={{alignItems:'center'}}><View accessibilityLabel="Điểm đón đã xác nhận" style={styles.pickup}><View style={styles.dot}/></View>{fill&&<Text style={{maxWidth:180,backgroundColor:'white',color:palette.ink,padding:4,borderRadius:8,fontFamily:'Inter_600SemiBold',fontSize:12}}>Điểm đón{pickupLabel?`: ${pickupLabel}`:''}</Text>}</View></Marker>}
    {destination&&<Marker lngLat={[destination.lng,destination.lat]} anchor={fill?'top':'center'} offset={fill?[0,-16]:undefined}><View style={{alignItems:'center'}}><View accessibilityLabel="Điểm đến đã xác nhận" style={[styles.pickup,{backgroundColor:palette.ink}]}><Ionicons name="flag" color="white" size={16}/></View>{fill&&<Text style={{maxWidth:180,backgroundColor:'white',color:palette.ink,padding:4,borderRadius:8,fontFamily:'Inter_600SemiBold',fontSize:12}}>Điểm đến{destinationLabel?`: ${destinationLabel}`:''}</Text>}</View></Marker>}
    {candidate&&<Marker lngLat={[candidate.lng,candidate.lat]} anchor="top" offset={[0,-21]}><View style={{alignItems:'center'}}><View accessibilityLabel={`${candidateKind==='pickup'?'Điểm đón':'Điểm đến'} tạm chọn: ${candidateLabel??'Vị trí đã chọn'}, chưa xác nhận`} style={[styles.pickup,{width:42,height:42,borderStyle:'dashed',backgroundColor:'#b65d00'}]}><Ionicons name="location" color="white" size={22}/></View><Text style={{maxWidth:180,backgroundColor:'#fff3d6',color:palette.ink,padding:4,borderRadius:8,fontFamily:'Inter_600SemiBold',fontSize:12}}>Chưa xác nhận · {candidateLabel??'Vị trí đã chọn'}</Text></View></Marker>}
    {position&&<Marker lngLat={[position.lng,position.lat]}><View style={[styles.pickup,{backgroundColor:'#2c80e8'}]}><Ionicons name="navigate" color="white" size={18}/></View></Marker>}
  </Map><Pressable accessibilityRole="button" accessibilityLabel={fitKey===undefined?'Đưa bản đồ về điểm đón':'Xem toàn tuyến hoặc các điểm đã chọn'} style={styles.recenter} onPress={fitKey===undefined?()=>camera.current?.flyTo({center:position?[position.lng,position.lat]:center,zoom:15,duration:500}):fitDriver}><Ionicons name="locate" size={22} color={palette.ink}/></Pressable>{onSelect&&<View pointerEvents="none" style={[styles.hint,{right:76}]}><Text style={styles.hintText}>{selectionLabel??'Chạm bản đồ để chọn vị trí'}</Text></View>}{error&&<View style={styles.error}><Text>Bản đồ chưa tải được. Điểm và tuyến vẫn được giữ.</Text><Pressable accessibilityRole="button" accessibilityLabel="Thử tải lại bản đồ" style={{minHeight:48,justifyContent:'center'}} onPress={()=>{setReady(false);tileFailed.current=false;setError(false);fitted.current=null;setRetry(value=>value+1)}}><Text style={styles.hintText}>Thử tải lại bản đồ</Text></Pressable></View>}</View>;
}
const styles=StyleSheet.create({container:{borderRadius:24,overflow:'hidden',backgroundColor:'#e4eee9'},map:{flex:1},pickup:{width:32,height:32,borderRadius:20,backgroundColor:palette.primary,borderWidth:3,borderColor:'white',alignItems:'center',justifyContent:'center'},dot:{backgroundColor:'white',width:9,height:9,borderRadius:8},recenter:{position:'absolute',top:14,right:14,width:48,height:48,borderRadius:24,backgroundColor:'white',alignItems:'center',justifyContent:'center',elevation:3},hint:{position:'absolute',top:14,left:14,padding:10,borderRadius:20,backgroundColor:'white'},hintText:{fontFamily:'Inter_600SemiBold',fontSize:12,color:palette.primary},error:{position:'absolute',bottom:40,left:15,right:15,backgroundColor:'white',padding:12,borderRadius:14}});
