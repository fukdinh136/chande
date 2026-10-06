import {View,Text,Image} from 'react-native';
import {palette} from './design';
export function Avatar({name,url}:{name:string;url?:string|null}){return <View style={{height:64,width:64,borderRadius:32,backgroundColor:palette.container,overflow:'hidden',alignItems:'center',justifyContent:'center'}}>{url?.startsWith('https://')?<Image source={{uri:url}} style={{height:64,width:64}}/>:<Text style={{fontFamily:'Inter_700Bold',color:palette.primary,fontSize:24}}>{name.trim().split(/\s+/).slice(-2).map(s=>s[0]).join('').toUpperCase()||'V'}</Text>}</View>}
