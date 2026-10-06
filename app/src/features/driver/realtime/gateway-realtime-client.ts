import {io,type Socket} from 'socket.io-client';
import {TripEvents} from '../../backend/trip-events';
import type {RealtimeClient,RealtimeNotice,Position} from './realtime-client';
export class GatewayRealtimeClient implements RealtimeClient {
  readonly capabilities={tripNotifications:true,gps:false,presence:false};
  readonly reason='Trip WebSocket và Matching offer đã kết nối Gateway; GPS foreground bật riêng.';
  private socket:Socket|null=null;private timer:ReturnType<typeof setTimeout>|undefined;private stopped=true;
  private listeners=new Set<(notice:RealtimeNotice)=>void>();private trips:TripEvents;
  constructor(private readonly base:string,private readonly token:()=>Promise<string>){this.trips=new TripEvents(base,token);this.trips.subscribe(()=>this.notify('trip-invalidated'))}
  private notify(kind:RealtimeNotice['kind']){this.listeners.forEach(f=>f({kind}))}
  subscribe(listener:(notice:RealtimeNotice)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  async connect(){
    this.disconnect();this.stopped=false;this.trips.start();
    const socket=io(this.base+'/realtime',{path:'/socket.io/',transports:['websocket'],forceNew:true,autoConnect:false,reconnectionDelay:1000,reconnectionDelayMax:10000,
      auth:callback=>{void this.token().then(token=>{if(!this.stopped)callback({token})}).catch(()=>{if(!this.stopped)callback({})})}});
    this.socket=socket;
    socket.on('connect',()=>this.notify('reconnected'));
    for(const event of ['driver.trip.offer','driver.trip.offer.updated'])socket.on(event,()=>this.notify('trip-invalidated'));
    const retry=()=>{if(this.stopped||this.timer)return;this.timer=setTimeout(()=>{this.timer=undefined;if(!this.stopped&&!socket.connected)socket.connect()},5000)};
    socket.on('connect_error',()=>{this.notify('error');retry()});socket.on('disconnect',reason=>{this.notify('disconnected');if(reason==='io server disconnect')retry()});socket.connect();
  }
  disconnect(){this.stopped=true;this.trips.stop();if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.socket?.removeAllListeners();this.socket?.disconnect();this.socket=null}
  async sendPosition(_position:Position){throw Error('GPS_USE_FOREGROUND_PUBLISHER')}
}
