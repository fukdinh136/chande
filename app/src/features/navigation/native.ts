import {requireOptionalNativeModule} from 'expo-modules-core';
export interface Progress {sessionId:string;remainingDistanceMeters:number;remainingDurationSeconds:number;distanceToManeuverMeters:number;street:string|null;maneuver:string|null;modifier:string|null;lat:number;lng:number}
interface Engine {start(route:string,sessionId:string):boolean;pushLocation(lat:number,lng:number,accuracy:number,time:number,speed:number,bearing:number):void;stop():void;addListener(event:'progress',callback:(p:Progress)=>void):{remove():void};addListener(event:'offRoute',callback:(p:{sessionId:string})=>void):{remove():void}}
export const Navigation=requireOptionalNativeModule<Engine>('VeloxNavigation');
