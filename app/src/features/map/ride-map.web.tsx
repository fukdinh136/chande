import {useEffect,useRef,useState} from 'react';
import type {RideMapProps} from './ride-map';
import type {Point} from '../backend/clients';
import {palette} from '../ui/design';

const project=(p:Point,z:number)=>{
  const size=256*2**z,sin=Math.sin(Math.max(-85,Math.min(85,p.lat))*Math.PI/180);
  return {x:(p.lng+180)/360*size,y:(0.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*size};
};
const unproject=(x:number,y:number,z:number):Point=>{
  const size=256*2**z;
  return {lng:((x/size*360)%360+360)%360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*y/size)))*180/Math.PI};
};

// Browser preview uses raster tiles; Android keeps its MapLibre Native renderer.
export function RideMap({pickup,destination,position,line,onSelect,height:fixedHeight=320,follow=false,fitKey,fill=false,candidate,candidateKind,candidateLabel,pickupLabel,destinationLabel,selectionLabel}:RideMapProps){
  const container=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:480,height:fixedHeight}),[failedTiles,setFailedTiles]=useState<ReadonlySet<string>>(()=>new Set()),[retry,setRetry]=useState(0);
  const width=size.width,height=fill?size.height:fixedHeight;
  const [manual,setManual]=useState<{line:RideMapProps['line'];scope?:string;center:Point;zoom:number}|null>(null);
  const [initialPosition,setInitialPosition]=useState<{key:string|undefined;point:Point|null}>({key:fitKey,point:position??null});
  if(fitKey!==undefined&&(initialPosition.key!==fitKey||(!initialPosition.point&&position)))setInitialPosition({key:fitKey,point:position??null});
  useEffect(()=>{
    if(!container.current)return;
    const observer=new ResizeObserver(entries=>setSize({width:entries[0].contentRect.width,height:entries[0].contentRect.height}));
    observer.observe(container.current);return()=>observer.disconnect();
  },[]);
  const scope=fitKey===undefined?undefined:`${fitKey}/${pickup?.lat},${pickup?.lng}/${destination?.lat},${destination?.lng}/${candidate?.lat},${candidate?.lng}`;
  const valid=(p:Point|undefined|null):p is Point=>!!p&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=85.05112878&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180;
  const routePoints=line?.map(([lng,lat])=>({lat,lng})).filter(valid);
  const targets=fitKey===undefined?line&&line.length>1?line.map(([lng,lat])=>({lat,lng})):[]:routePoints&&routePoints.length>1?routePoints:[pickup,destination,candidate].filter(valid);
  let center=fitKey===undefined?pickup??{lat:21.0285,lng:105.8542}:targets[0]??initialPosition.point??{lat:21.0285,lng:105.8542},zoom=fitKey===undefined?14:15;
  if(targets.length>1){
    const points=targets.map(point=>project(point,0)),xs=points.map(p=>p.x),ys=points.map(p=>p.y);
    const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
    center=unproject((left+right)/2,(top+bottom)/2,0);
    zoom=Math.max(10,Math.min(17,Math.floor(Math.log2(Math.min(Math.max(1,width-70)/Math.max(0.001,right-left),Math.max(1,height-80)/Math.max(0.001,bottom-top))))));
  }
  const fittedCenter=center,fittedZoom=zoom;
  if(manual?.line===line&&manual&&manual.scope===scope){center=manual.center;zoom=manual.zoom}
  if(fitKey===undefined&&follow&&position)center=position;
  const origin=project(center,zoom),left=origin.x-width/2,top=origin.y-height/2,count=2**zoom;
  const tiles=[];let error=false;
  for(let x=Math.floor(left/256);x<=Math.floor((left+width)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+height)/256);y++){
    if(y<0||y>=count)continue;
    const wrapped=(x%count+count)%count,key=`${zoom}/${x}/${y}`;
    error=error||failedTiles.has(key);
    const status=(failed:boolean)=>setFailedTiles(previous=>{
      if(previous.has(key)===failed)return previous;
      const next=new Set(previous);if(failed)next.add(key);else next.delete(key);return next;
    });
    tiles.push(<img key={key} alt="" draggable={false} onError={()=>status(true)} onLoad={()=>status(false)} src={`https://tile.openstreetmap.org/${zoom}/${wrapped}/${y}.png${retry?`?retry=${retry}`:''}`} style={{position:'absolute',left:x*256-left,top:y*256-top,width:256,height:256}}/>);
  }
  const marker=(point:Point|undefined|null,label:string,color:string)=>{
    if(!point)return null;const pixel=project(point,zoom);
    return <><div aria-label={label} title={label} style={{position:'absolute',left:pixel.x-left,top:pixel.y-top,transform:'translate(-50%, -50%)',width:28,height:28,borderRadius:20,border:'3px solid white',background:color,boxShadow:'0 2px 5px #0004',display:'grid',placeItems:'center',color:'white',fontSize:13,pointerEvents:'none'}}>{label.startsWith('Điểm đến')?'⚑':'●'}</div>{fill&&<div style={{position:'absolute',left:pixel.x-left,top:pixel.y-top+20,transform:'translateX(-50%)',maxWidth:180,background:'white',color:palette.ink,padding:4,borderRadius:8,fontSize:12,pointerEvents:'none'}}>{label}</div>}</>;
  };
  const buttonStyle={border:0,borderRadius:12,padding:'10px 13px',minHeight:48,minWidth:48,background:'white',color:palette.ink,fontSize:18,cursor:'pointer'};
  return <div ref={container} style={{height:fill?'100%':height,position:'relative',overflow:'hidden',borderRadius:fill?0:24,background:'#e4eee9',cursor:onSelect?'crosshair':'default'}} onClick={e=>{
    if(!onSelect)return;const bounds=e.currentTarget.getBoundingClientRect();onSelect(unproject(left+e.clientX-bounds.left,top+e.clientY-bounds.top,zoom));
  }}>
    {tiles}
    {line&&<svg width={width} height={height} aria-label="Tuyến đường từ backend" style={{position:'absolute',inset:0,pointerEvents:'none'}}><polyline points={line.map(([lng,lat])=>{const p=project({lat,lng},zoom);return `${p.x-left},${p.y-top}`}).join(' ')} fill="none" stroke={palette.primary} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round"/></svg>}
    {marker(pickup,`Điểm đón${pickupLabel?`: ${pickupLabel}`:''}`,palette.primary)}{marker(destination,`Điểm đến${destinationLabel?`: ${destinationLabel}`:''}`,palette.ink)}{marker(position,'Vị trí tài xế','#2c80e8')}
    {marker(candidate,`${candidateKind==='pickup'?'Điểm đón':'Điểm đến'} tạm chọn: ${candidateLabel??'Vị trí đã chọn'}, chưa xác nhận`,'#b65d00')}
    {onSelect&&<div style={{position:'absolute',top:14,left:14,right:76,background:'white',borderRadius:20,padding:10,fontSize:12,color:palette.primary,pointerEvents:'none'}}>{selectionLabel??'Chạm bản đồ để chọn vị trí'}</div>}
    <div style={{position:'absolute',top:14,right:14,display:'flex',flexDirection:'column',gap:6}} onClick={e=>e.stopPropagation()}>
      <button aria-label={fitKey===undefined?'Đưa bản đồ về điểm đón':'Xem toàn tuyến hoặc vị trí hiện tại'} style={buttonStyle} onClick={()=>setManual({line,scope,center:fitKey===undefined?position??pickup??center:targets.length?fittedCenter:position??fittedCenter,zoom:fitKey===undefined?15:fittedZoom})}>⌖</button>
      <button aria-label="Phóng to bản đồ" style={buttonStyle} onClick={()=>setManual({line,scope,center,zoom:Math.min(18,zoom+1)})}>+</button>
      <button aria-label="Thu nhỏ bản đồ" style={buttonStyle} onClick={()=>setManual({line,scope,center,zoom:Math.max(10,zoom-1)})}>−</button>
    </div>
    {error&&<div role="status" onClick={event=>event.stopPropagation()} style={{position:'absolute',bottom:30,left:14,right:14,padding:10,borderRadius:12,background:'white',fontSize:12}}>Bản đồ chưa tải được. Điểm và tuyến vẫn được giữ.<button style={{...buttonStyle,minHeight:48,display:'block',fontSize:14}} onClick={()=>{setFailedTiles(new Set());setRetry(value=>value+1)}}>Thử tải lại bản đồ</button></div>}
    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{position:'absolute',bottom:0,right:0,padding:'3px 6px',background:'#fffc',color:'#345',fontSize:10}}>© OpenStreetMap contributors</a>
  </div>;
}
