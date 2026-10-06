const fs=require('node:fs'),zlib=require('node:zlib'),path=require('node:path');
const root=path.join(process.cwd(),'assets/images'),size=1024,polygon=[[566,238],[342,550],[486,550],[431,791],[728,434],[554,434]];
const crc=b=>{let n=0xffffffff;for(const v of b){n^=v;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0)}return (n^0xffffffff)>>>0};
const chunk=(type,data)=>{const key=Buffer.from(type),length=Buffer.alloc(4),check=Buffer.alloc(4);length.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([key,data])));return Buffer.concat([length,key,data,check])};
const inside=(x,y)=>{let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if(((a[1]>y)!==(b[1]>y))&&(x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]))yes=!yes}return yes};
for(const role of ['customer','driver'])for(const transparent of [false,true]){
 const bg=role==='customer'?[0,104,95]:[11,28,48],data=Buffer.alloc(size*(size*4+1));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const at=y*(size*4+1)+1+x*4,bolt=inside(x,y),dot=(x-733)**2+(y-247)**2<48**2,color=bolt?[255,255,255]:dot?[107,216,203]:bg;data[at]=color[0];data[at+1]=color[1];data[at+2]=color[2];data[at+3]=transparent&&!bolt&&!dot?0:255}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
 const target=path.join(root,'velox-'+role+(transparent?'-foreground':'')+'.png');fs.writeFileSync(target,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(data)),chunk('IEND',Buffer.alloc(0))]));
}
console.log('Four Velox vector-derived PNG assets created');
