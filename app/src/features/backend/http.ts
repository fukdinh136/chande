export type Service = 'user' | 'driver' | 'trip' | 'matching' | 'routing';
export class BackendError extends Error {
  constructor(readonly code: string, readonly status = 0, readonly requestId?: string, readonly retryAfter?: number, readonly fields?: Record<string,string>) { super(code); this.name = 'BackendError'; }
}
export interface ApiRequest {
  service: Service; path: string; method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'; body?: unknown;
  token?: string; key?: string; requestId?: string; signal?: AbortSignal; query?: Record<string,string>;
}
export interface ApiResult { data: unknown; status: number; replayed: boolean; serverDate: number | null }
export type Fetcher = typeof globalThis.fetch;
export function origin(value: string, development: boolean) {
  let url: URL; try { url = new URL(value); } catch { throw new BackendError('CONFIGURATION_REQUIRED'); }
  if (!['https:','http:'].includes(url.protocol) || (!development && url.protocol!=='https:') || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw new BackendError('CONFIGURATION_REQUIRED');
  return url.origin;
}
export function record(value: unknown): Record<string,unknown> { if(!value || typeof value!=='object' || Array.isArray(value))throw new BackendError('INVALID_RESPONSE'); return value as Record<string,unknown>; }
export function id(value: unknown): string { if(typeof value!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new BackendError('INVALID_RESPONSE');return value.toLowerCase(); }
export class BackendHttp {
  constructor(readonly base: string, private readonly fetcher: Fetcher = globalThis.fetch, private readonly timeout = 10000) {}
  async send(r: ApiRequest): Promise<ApiResult> {
    if(!/^\/[a-zA-Z0-9/_-]+$/.test(r.path) || r.path.includes('//') || r.path.startsWith('/internal') || r.path.startsWith('/api/'))throw new BackendError('INVALID_ROUTE');
    const url=new URL(this.base+'/api/v1'+r.path); for(const [k,v]of Object.entries(r.query??{}))url.searchParams.set(k,v);
    const controller=new AbortController();let timedOut=false; const cancel=()=>controller.abort();r.signal?.addEventListener('abort',cancel,{once:true});if(r.signal?.aborted)cancel();
    const timer=setTimeout(()=>{timedOut=true;controller.abort()},this.timeout);
    try {
      // Window.fetch rejects a class instance as its receiver in browsers.
      const fetcher=this.fetcher;
      const response=await fetcher(url.toString(),{method:r.method??'GET',signal:controller.signal,redirect:'error',credentials:'omit',headers:{Accept:'application/json',...(r.body===undefined?{}:{'Content-Type':'application/json'}),...(r.token?{Authorization:'Bearer '+r.token}:{}),...(r.key?{'Idempotency-Key':id(r.key)}:{}),...(r.requestId?{'X-Request-Id':id(r.requestId)}:{})},...(r.body===undefined?{}:{body:JSON.stringify(r.body)})});
      let payload: unknown=null;
      if(response.status!==204){try{payload=await response.json()}catch{throw new BackendError('INVALID_RESPONSE',response.status)}}
      if(!response.ok){
        const body=record(payload), error=body.error?record(body.error):body,meta=body.meta?record(body.meta):{};
        const code=typeof error.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'INVALID_RESPONSE';
        const fields=error.fieldErrors&&typeof error.fieldErrors==='object'?error.fieldErrors as Record<string,string>:undefined;
        const retry=Number(response.headers.get('Retry-After'));
        throw new BackendError(code,response.status,typeof meta.requestId==='string'?meta.requestId:response.headers.get('X-Request-Id')??undefined,Number.isFinite(retry)&&retry>0?retry:undefined,fields);
      }
      let data=payload;
      if(response.status!==204 && r.service!=='user'){const e=record(payload);if(!('data'in e))throw new BackendError('INVALID_RESPONSE',response.status);const meta=record(e.meta);id(meta.requestId);data=e.data;}
      const date=Date.parse(response.headers.get('Date')??'');
      return {data,status:response.status,replayed:response.headers.get('Idempotent-Replay')==='true'||response.headers.get('Idempotency-Replayed')==='true',serverDate:Number.isFinite(date)?date:null};
    }catch(e){if(e instanceof BackendError)throw e;if(controller.signal.aborted)throw new BackendError(timedOut?'TIMEOUT':'CANCELLED');throw new BackendError('NETWORK_ERROR')}
    finally{clearTimeout(timer);r.signal?.removeEventListener('abort',cancel)}
  }
}
