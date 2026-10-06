export function decodePolyline(value:string,minimumPoints:1|2=2):[number,number][]{
  const coords:[number,number][]=[];let i=0,lat=0,lng=0;
  const number=()=>{let result=0,shift=0,b=0;do{if(i>=value.length||shift>30)throw Error('INVALID_POLYLINE');b=value.charCodeAt(i++)-63;if(b<0||b>63)throw Error('INVALID_POLYLINE');result|=(b&31)<<shift;shift+=5}while(b>=32);return result&1?~(result>>1):result>>1};
  while(i<value.length){lat+=number();lng+=number();if(Math.abs(lat)>90000000||Math.abs(lng)>180000000)throw Error('INVALID_POLYLINE');coords.push([lng/1e6,lat/1e6])}if(coords.length<minimumPoints)throw Error('INVALID_POLYLINE');return coords;
}
