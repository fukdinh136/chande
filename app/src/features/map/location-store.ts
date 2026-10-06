import {useSyncExternalStore} from 'react';
export interface Sample {lat:number;lng:number;accuracy:number;timestamp:number;speed:number;heading:number}
let sample:Sample|null=null;const listeners=new Set<()=>void>();
export function setLocation(value:Sample|null){sample=value;listeners.forEach(f=>f())}
export function currentLocation(){return sample}
export function subscribeLocation(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn)}}
export function useLocation(){return useSyncExternalStore(subscribeLocation,currentLocation,currentLocation)}
