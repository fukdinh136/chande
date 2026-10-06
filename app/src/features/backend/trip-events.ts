export type EventSocket=Pick<WebSocket,'onopen'|'onmessage'|'onclose'|'onerror'|'send'|'close'>;
// Messages invalidate REST projections. They never replace versioned Trip state.
export class TripEvents {
  private socket:EventSocket|null=null;private stopped=true;private generation=0;
  private retry:ReturnType<typeof setTimeout>|undefined;private ping:ReturnType<typeof setInterval>|undefined;
  private listeners=new Set<()=>void>();
  constructor(private readonly base:string,private readonly token:()=>Promise<string>,private readonly open:(url:string)=>EventSocket=(url)=>new WebSocket(url)){}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}};
  start(){this.stop();this.stopped=false;void this.connect(this.generation)}
  private async connect(generation:number){
    try{
      const token=await this.token();if(this.stopped||generation!==this.generation)return;
      const socket=this.open(this.base.replace(/^http/,'ws')+'/ws');this.socket=socket;
      socket.onopen=()=>socket.send(JSON.stringify({type:'auth',token}));
      socket.onmessage=e=>{
        if(this.stopped||this.socket!==socket)return;
        try{const message=JSON.parse(String(e.data));if(message.type==='auth.ok'){
          this.listeners.forEach(f=>f());if(this.ping)clearInterval(this.ping);
          this.ping=setInterval(()=>socket.send(JSON.stringify({type:'ping'})),25000);
        }else if(message.type==='trip.event'&&message.event&&typeof message.event==='object')this.listeners.forEach(f=>f());}catch{/* malformed payload cannot update state */}
      };
      socket.onclose=()=>{if(this.socket!==socket)return;this.socket=null;if(this.ping)clearInterval(this.ping);this.reconnect(generation)};
      socket.onerror=()=>socket.close();
    }catch{this.reconnect(generation)}
  }
  private reconnect(generation:number){if(this.stopped||generation!==this.generation||this.retry)return;this.retry=setTimeout(()=>{this.retry=undefined;void this.connect(generation)},5000)}
  stop(){this.stopped=true;this.generation++;if(this.retry)clearTimeout(this.retry);if(this.ping)clearInterval(this.ping);this.retry=undefined;this.ping=undefined;const s=this.socket;this.socket=null;if(s){s.onclose=null;s.onopen=null;s.onmessage=null;s.onerror=null;s.close()}}
}
