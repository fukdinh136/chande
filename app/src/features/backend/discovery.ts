import { BackendError, origin, record, type Fetcher } from './http';
export interface BackendDiscovery { development:boolean; platform:'android'|'web'|'ios'; explicit?:string; signal?:AbortSignal }
export function candidates(input:BackendDiscovery):string[]{
  if(input.explicit)return [origin(input.explicit,input.development)];
  if(!input.development)throw new BackendError('CONFIGURATION_REQUIRED');
  const hosts=input.platform==='android'?['10.0.2.2','127.0.0.1']:['127.0.0.1'];
  return hosts.flatMap(host=>[18080,18081].map(port=>`http://${host}:${port}`));
}
export async function discover(input:BackendDiscovery,fetcher:Fetcher=globalThis.fetch):Promise<string>{
  for(const base of candidates(input)){
    if(input.signal?.aborted)throw new BackendError('CANCELLED');
    const control=new AbortController(),abort=()=>control.abort(),timer=setTimeout(abort,2000);
    input.signal?.addEventListener('abort',abort,{once:true});
    try{
      // An ingress liveness 200 is insufficient; check the Gateway business auth envelope without a token.
      const response=await fetcher(base+'/api/v1/trips/active',{signal:control.signal,redirect:'error',credentials:'omit'});
      if(response.status!==401)continue;
      const body=record(await response.json()),error=record(body.error),meta=record(body.meta);
      if(error.code==='UNAUTHENTICATED'&&typeof meta.requestId==='string')return base;
    }catch{/* Try only known local ingress addresses, never scan LAN or move a logged-in session. */}
    finally{clearTimeout(timer);input.signal?.removeEventListener('abort',abort)}
  }
  if(input.signal?.aborted)throw new BackendError('CANCELLED');
  throw new BackendError('BACKEND_NOT_FOUND');
}
