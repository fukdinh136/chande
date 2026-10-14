import {useCallback,useEffect,useRef,useState,useMemo} from 'react';
import {View,Text,StyleSheet,Pressable} from 'react-native';
import {Map,Camera,Marker,GeoJSONSource,Layer,type CameraRef} from '@maplibre/maplibre-react-native';
import {Ionicons} from '@expo/vector-icons';
import type {Point} from '../backend/clients';
import {palette} from '../ui/design';
export interface RideMapProps {pickup?:Point;destination?:Point;position?:Point|null;line?:[number,number][];onSelect?:(point:Point)=>void;height?:number;follow?:boolean;fitKey?:string}
// fitKey opts Driver into fitting trip/phase/route changes. Existing callers keep their camera policy.
export function RideMap({pickup,destination,position,line,onSelect,height=320,follow=false,fitKey}:RideMapProps){
  const camera=useRef<CameraRef>(null),[error,setError]=useState(false);
  const [ready,setReady]=useState(false),latestPosition=useRef(position),fitted=useRef<object|null>(null);
  useEffect(()=>{latestPosition.current=position},[position]);
  const pickupLat=pickup?.lat,pickupLng=pickup?.lng,destinationLat=destination?.lat,destinationLng=destination?.lng;
  const points=useMemo(()=>{
    if(fitKey===undefined)return null;
    const valid=([lng,lat]:[number,number])=>Number.isFinite(lng)&&Math.abs(lng)<=180&&Number.isFinite(lat)&&Math.abs(lat)<=85.05112878;
    const route=line?.filter(valid);
    return route&&route.length>1?route:([[pickupLng,pickupLat],[destinationLng,destinationLat]] as [number,number][]).filter(valid);
  },[fitKey,line,pickupLat,pickupLng,destinationLat,destinationLng]);
  const fitDriver=useCallback(()=>{
    if(!points||!camera.current)return;
    const p=latestPosition.current;
    const target=points.length?points:p&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=85.05112878&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180?[[p.lng,p.lat]]:[];
    if(!target.length)return;
    let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
    for(const [lng,lat] of target){west=Math.min(west,lng);south=Math.min(south,lat);east=Math.max(east,lng);north=Math.max(north,lat)}
    if(west===east&&south===north)camera.current?.easeTo({center:[west,south],zoom:15,duration:500});
    else camera.current?.fitBounds([west,south,east,north],{padding:{top:45,bottom:60,left:35,right:35},duration:600});
    fitted.current=points;
  },[points]);
  const hasPosition=!!position;
  useEffect(()=>{if(ready&&points&&fitted.current!==points&&(points.length||hasPosition))fitDriver()},[ready,points,hasPosition,fitDriver]);
  const routeData=useMemo(()=>line?{type:'Feature' as const,properties:{},geometry:{type:'LineString' as const,coordinates:line}}:undefined,[line]);
  useEffect(()=>{if(fitKey===undefined&&follow&&position)camera.current?.easeTo({center:[position.lng,position.lat],zoom:16,pitch:35,duration:700})},[fitKey,follow,position]);
  useEffect(()=>{if(fitKey===undefined&&line&&line.length>1){const lng=line.map(p=>p[0]),lat=line.map(p=>p[1]);camera.current?.fitBounds([Math.min(...lng),Math.min(...lat),Math.max(...lng),Math.max(...lat)],{padding:{top:45,bottom:60,left:35,right:35},duration:600})}},[fitKey,line]);
  const center:[number,number]=[pickup?.lng??105.8542,pickup?.lat??21.0285];
  return <View style={[styles.container,{height}]}><Map style={styles.map} mapStyle={process.env.EXPO_PUBLIC_MAP_STYLE_URL??'https://tiles.openfreemap.org/styles/liberty'} onPress={e=>onSelect?.({lng:e.nativeEvent.lngLat[0],lat:e.nativeEvent.lngLat[1]})} onDidFinishLoadingMap={fitKey===undefined?undefined:()=>{setReady(true);setError(false)}} onDidFailLoadingMap={()=>setError(true)}><Camera ref={camera} initialViewState={{center,zoom:14}}/>
    {routeData&&<GeoJSONSource id="route" data={routeData}><Layer id="route-shadow" type="line" paint={{'line-color':'#8be0d6','line-width':11,'line-opacity':0.6}}/><Layer id="route-line" type="line" paint={{'line-color':palette.primary,'line-width':5}}/></GeoJSONSource>}
    {pickup&&<Marker lngLat={[pickup.lng,pickup.lat]}><View style={styles.pickup}><View style={styles.dot}/></View></Marker>}
    {destination&&<Marker lngLat={[destination.lng,destination.lat]}><View style={[styles.pickup,{backgroundColor:palette.ink}]}><Ionicons name="flag" color="white" size={16}/></View></Marker>}
    {position&&<Marker lngLat={[position.lng,position.lat]}><View style={[styles.pickup,{backgroundColor:'#2c80e8'}]}><Ionicons name="navigate" color="white" size={18}/></View></Marker>}
  </Map><Pressable accessibilityRole="button" accessibilityLabel={fitKey===undefined?'Đưa bản đồ về điểm đón':'Xem toàn tuyến hoặc các điểm của chuyến; khi chưa có chuyến, xem vị trí hiện tại'} style={styles.recenter} onPress={fitKey===undefined?()=>camera.current?.flyTo({center:position?[position.lng,position.lat]:center,zoom:15,duration:500}):fitDriver}><Ionicons name="locate" size={22} color={palette.ink}/></Pressable>{onSelect&&<View style={styles.hint}><Text style={styles.hintText}>Chạm bản đồ để chọn vị trí</Text></View>}{error&&<View style={styles.error}><Text>Bản đồ chưa tải được. Kiểm tra Internet; điểm và tuyến vẫn được giữ.</Text></View>}</View>;
}
const styles=StyleSheet.create({container:{borderRadius:24,overflow:'hidden',backgroundColor:'#e4eee9'},map:{flex:1},pickup:{width:32,height:32,borderRadius:20,backgroundColor:palette.primary,borderWidth:3,borderColor:'white',alignItems:'center',justifyContent:'center'},dot:{backgroundColor:'white',width:9,height:9,borderRadius:8},recenter:{position:'absolute',top:14,right:14,width:48,height:48,borderRadius:24,backgroundColor:'white',alignItems:'center',justifyContent:'center',elevation:3},hint:{position:'absolute',top:14,left:14,padding:10,borderRadius:20,backgroundColor:'white'},hintText:{fontFamily:'Inter_600SemiBold',fontSize:12,color:palette.primary},error:{position:'absolute',bottom:40,left:15,right:15,backgroundColor:'white',padding:12,borderRadius:14}});
