import {useState} from 'react';
import {View,Text,Image} from 'react-native';
import {palette} from './design';
export function Avatar({name,url}:{name:string;url?:string|null}){
  const [failed, setFailed] = useState<string | null>(null);
  return <View style={{height:64,width:64,borderRadius:32,backgroundColor:palette.container,overflow:'hidden',alignItems:'center',justifyContent:'center'}}>
    {url && /^https?:\/\//.test(url) && failed !== url ? <Image key={url} accessibilityLabel={`Ảnh đại diện ${name}`} source={{uri:url}} onError={() => setFailed(url)} style={{height:64,width:64}}/> : <Text accessibilityLabel={`Tên viết tắt ${name}`} style={{fontFamily:'Inter_700Bold',color:palette.primary,fontSize:24}}>{name.trim().split(/\s+/).slice(-2).map(s=>s[0]).join('').toUpperCase()||'V'}</Text>}
  </View>;
}
