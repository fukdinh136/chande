import {createContext,useContext,useCallback,useEffect,type PropsWithChildren} from 'react';
import {Modal,View} from 'react-native';
import {router,usePathname} from 'expo-router';
import {useDriverRuntime} from './driver-provider';
import {useFocusedResource,type Resource} from '../hooks/use-focused-resource';
import type {Offer} from '../../backend/clients';
import {OffersScreen} from '../screens/offers-screen';
const Context=createContext<(Resource<Offer|null>&{refresh:()=>void})|null>(null);
export function OffersProvider({children}:PropsWithChildren){
  const runtime=useDriverRuntime(),path=usePathname();
  const resource=useFocusedResource(useCallback((signal:AbortSignal)=>runtime.matching.active(signal),[runtime]),runtime.matching.available,5000),refresh=resource.refresh;
  useEffect(()=>runtime.realtime.subscribe(()=>refresh()),[runtime.realtime,refresh]);
  return <Context.Provider value={resource}>{children}<Modal transparent visible={resource.data?.status==='PENDING'&&!path.includes('/offers')} animationType="slide" onRequestClose={()=>router.push('/driver/offers')}><View style={{flex:1,backgroundColor:'#0b1c3070',justifyContent:'flex-end'}}><View style={{height:'90%',borderTopLeftRadius:28,borderTopRightRadius:28,overflow:'hidden'}}><OffersScreen/></View></View></Modal></Context.Provider>;
}
export function useOffers(){const value=useContext(Context);if(!value)throw Error('OffersProvider required');return value}
