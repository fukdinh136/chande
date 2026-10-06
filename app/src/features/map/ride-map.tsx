import {useEffect,useRef,useState,useMemo} from 'react';
import {View,Text,StyleSheet,Pressable} from 'react-native';
import {Map,Camera,Marker,GeoJSONSource,Layer,type CameraRef} from '@maplibre/maplibre-react-native';
import {Ionicons} from '@expo/vector-icons';
import type {Point} from '../backend/clients';
import {palette} from '../ui/design';
export interface RideMapProps {pickup?:Point;destination?:Point;position?:Point|null;line?:[number,number][];onSelect?:(point:Point)=>void;height?:number;follow?:boolean}
export function RideMap({pickup,destination,position,line,onSelect,height=320,follow=false}:RideMapProps){
  const camera=useRef<CameraRef>(null),[error,setError]=useState(false);
  const routeData=useMemo(()=>line?{type:'Feature' as const,properties:{},geometry:{type:'LineString' as const,coordinates:line}}:undefined,[line]);
  useEffect(()=>{if(follow&&position)camera.current?.easeTo({center:[position.lng,position.lat],zoom:16,pitch:35,duration:700})},[follow,position]);
  useEffect(()=>{if(line&&line.length>1){const lng=line.map(p=>p[0]),lat=line.map(p=>p[1]);camera.current?.fitBounds([Math.min(...lng),Math.min(...lat),Math.max(...lng),Math.max(...lat)],{padding:{top:45,bottom:60,left:35,right:35},duration:600})}},[line]);
  const center:[number,number]=[pickup?.lng??105.8542,pickup?.lat??21.0285];
  return <View style={[styles.container,{height}]}><Map style={styles.map} mapStyle={process.env.EXPO_PUBLIC_MAP_STYLE_URL??'https://tiles.openfreemap.org/styles/liberty'} onPress={e=>onSelect?.({lng:e.nativeEvent.lngLat[0],lat:e.nativeEvent.lngLat[1]})} onDidFailLoadingMap={()=>setError(true)}><Camera ref={camera} initialViewState={{center,zoom:14}}/>
    {routeData&&<GeoJSONSource id="route" data={routeData}><Layer id="route-shadow" type="line" paint={{'line-color':'#8be0d6','line-width':11,'line-opacity':0.6}}/><Layer id="route-line" type="line" paint={{'line-color':palette.primary,'line-width':5}}/></GeoJSONSource>}
    {pickup&&<Marker lngLat={[pickup.lng,pickup.lat]}><View style={styles.pickup}><View style={styles.dot}/></View></Marker>}
    {destination&&<Marker lngLat={[destination.lng,destination.lat]}><View style={[styles.pickup,{backgroundColor:palette.ink}]}><Ionicons name="flag" color="white" size={16}/></View></Marker>}
    {position&&<Marker lngLat={[position.lng,position.lat]}><View style={[styles.pickup,{backgroundColor:'#2c80e8'}]}><Ionicons name="navigate" color="white" size={18}/></View></Marker>}
  </Map><Pressable accessibilityRole="button" accessibilityLabel="Đưa bản đồ về điểm đón" style={styles.recenter} onPress={()=>camera.current?.flyTo({center:position?[position.lng,position.lat]:center,zoom:15,duration:500})}><Ionicons name="locate" size={22} color={palette.ink}/></Pressable>{onSelect&&<View style={styles.hint}><Text style={styles.hintText}>Chạm bản đồ để chọn vị trí</Text></View>}{error&&<View style={styles.error}><Text>Bản đồ chưa tải được. Kiểm tra Internet; điểm và tuyến vẫn được giữ.</Text></View>}</View>;
}
const styles=StyleSheet.create({container:{borderRadius:24,overflow:'hidden',backgroundColor:'#e4eee9'},map:{flex:1},pickup:{width:32,height:32,borderRadius:20,backgroundColor:palette.primary,borderWidth:3,borderColor:'white',alignItems:'center',justifyContent:'center'},dot:{backgroundColor:'white',width:9,height:9,borderRadius:8},recenter:{position:'absolute',top:14,right:14,width:48,height:48,borderRadius:24,backgroundColor:'white',alignItems:'center',justifyContent:'center',elevation:3},hint:{position:'absolute',top:14,left:14,padding:10,borderRadius:20,backgroundColor:'white'},hintText:{fontFamily:'Inter_600SemiBold',fontSize:12,color:palette.primary},error:{position:'absolute',bottom:40,left:15,right:15,backgroundColor:'white',padding:12,borderRadius:14}});
