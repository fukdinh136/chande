export function instruction(type:string|null,modifier:string|null,street:string|null,exit?:number|null){
  let text='Tiếp tục đi thẳng';
  if(type==='arrive')return 'Bạn đã gần đến điểm đến';
  if(type==='roundabout'||type==='rotary')text=exit?`Qua vòng xuyến, ra lối ${exit}`:'Đi qua vòng xuyến';
  else if(modifier==='uturn')text='Quay đầu';
  else if(modifier?.includes('left'))text=modifier.startsWith('slight')?'Chếch trái':modifier.startsWith('sharp')?'Rẽ gấp trái':'Rẽ trái';
  else if(modifier?.includes('right'))text=modifier.startsWith('slight')?'Chếch phải':modifier.startsWith('sharp')?'Rẽ gấp phải':'Rẽ phải';
  else if(type==='merge')text='Nhập vào làn đường';
  else if(type==='depart')text='Bắt đầu di chuyển';
  return text+(street?' · '+street:'');
}
