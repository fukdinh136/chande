import { BackendError, BackendHttp, id, record, type ApiRequest } from './http';
export interface UserProfile {id:string;phoneNumber:string;fullName:string;avatarUrl:string|null;createdAt:string}
export interface UserTokens {accessToken:string;refreshToken:string;expiresIn:number;tokenType:'Bearer'}
export interface PlaceInput {label:string;addressText:string;lat:number;lng:number;makeDefault:boolean}
export type OfferStatus='PENDING'|'ASSIGNMENT_PENDING'|'ASSIGNED'|'DECLINED'|'EXPIRED'|'REJECTED'|'REVOKED';
export interface Point {lat:number;lng:number;address?:string}
export interface Quote {quoteId:string;expiresAt:string;amount:string;distance:number;duration:number}
export function quote(value:unknown):Quote {
  const q=record(value),f=record(q.fare),r=record(q.route);
  if(f.currency!=='VND'||!Number.isFinite(Date.parse(text(q.expiresAt)))||typeof r.distanceMeters!=='number'||!Number.isSafeInteger(r.distanceMeters)||r.distanceMeters<0||typeof r.durationSeconds!=='number'||!Number.isSafeInteger(r.durationSeconds)||r.durationSeconds<0)throw new BackendError('INVALID_RESPONSE');
  return {quoteId:id(q.quoteId),expiresAt:text(q.expiresAt),amount:money(f.amount),distance:r.distanceMeters,duration:r.durationSeconds};
}
export interface Offer {offerId:string;tripId:string;driverId:string;version:number;status:OfferStatus;expiresAt:string;pickup:Point;destination:Point;vehicleType:string;fare:{currency:'VND';amount:string}}
function text(v:unknown):string{if(typeof v!=='string')throw new BackendError('INVALID_RESPONSE');return v}
function positive(v:unknown):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<1)throw new BackendError('INVALID_RESPONSE');return v}
function money(v:unknown){const s=text(v);if(!/^(0|[1-9]\d*)$/.test(s))throw new BackendError('INVALID_RESPONSE');return s}
export function point(value:unknown):Point{const p=record(value);if(typeof p.lat!=='number'||typeof p.lng!=='number'||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)throw new BackendError('INVALID_RESPONSE');return {lat:p.lat,lng:p.lng,...(p.address===undefined?{}:{address:text(p.address)})}}
export function userTokens(value:unknown):UserTokens{const d=record(value);if(d.tokenType!=='Bearer')throw new BackendError('INVALID_RESPONSE');return {accessToken:text(d.accessToken),refreshToken:text(d.refreshToken),expiresIn:positive(d.expiresIn),tokenType:'Bearer'}}
export function userProfile(value:unknown):UserProfile{const d=record(value);return {id:id(d.id),phoneNumber:text(d.phoneNumber),fullName:text(d.fullName),avatarUrl:d.avatarUrl===null?null:text(d.avatarUrl),createdAt:text(d.createdAt)}}
const offerStatuses:OfferStatus[]=['PENDING','ASSIGNMENT_PENDING','ASSIGNED','DECLINED','EXPIRED','REJECTED','REVOKED'];
export function offer(value:unknown):Offer|null{
  if(value===null)return null;const d=record(value),fare=record(d.fare),status=text(d.status) as OfferStatus;
  if(!offerStatuses.includes(status)||fare.currency!=='VND'||!Number.isFinite(Date.parse(text(d.expiresAt))))throw new BackendError('INVALID_RESPONSE');
  return {offerId:id(d.offerId),tripId:id(d.tripId),driverId:id(d.driverId),version:positive(d.version),status,expiresAt:text(d.expiresAt),pickup:point(d.pickup),destination:point(d.destination),vehicleType:text(d.vehicleType),fare:{currency:'VND',amount:money(fare.amount)}};
}
export class UserApi {
  constructor(private readonly http:BackendHttp){}
  private async send(path:string,method:ApiRequest['method'],body?:unknown,token?:string){return (await this.http.send({service:'user',path,method,body,token})).data}
  register(phoneNumber:string,password:string,fullName:string){return this.send('/auth/register','POST',{phoneNumber,password,fullName})}
  async login(phoneNumber:string,password:string){return userTokens(await this.send('/auth/login','POST',{phoneNumber,password}))}
  async refresh(refreshToken:string){return userTokens(await this.send('/auth/refresh','POST',{refreshToken}))}
  logout(refreshToken:string){return this.send('/auth/logout','POST',{refreshToken})}
  logoutAll(token:string){return this.send('/auth/logout-all','POST',undefined,token)}
  async profile(token:string){return userProfile(await this.send('/users/me','GET',undefined,token))}
  async updateProfile(token:string,body:{fullName?:string;avatarUrl?:string|null}){return userProfile(await this.send('/users/me','PATCH',body,token))}
  changePassword(token:string,oldPassword:string,newPassword:string){return this.send('/users/me/password','POST',{oldPassword,newPassword},token)}
  places(token:string){return this.send('/users/me/addresses','GET',undefined,token)}
  createPlace(token:string,body:PlaceInput){return this.send('/users/me/addresses','POST',body,token)}
  updatePlace(token:string,placeId:string,body:PlaceInput){return this.send('/users/me/addresses/'+id(placeId),'PUT',body,token)}
  defaultPlace(token:string,placeId:string){return this.send('/users/me/addresses/'+id(placeId)+'/default','PUT',undefined,token)}
  deletePlace(token:string,placeId:string){return this.send('/users/me/addresses/'+id(placeId),'DELETE',undefined,token)}
}
export class OfferApi {
  constructor(private readonly http:BackendHttp){}
  async active(token:string,signal?:AbortSignal){return offer((await this.http.send({service:'matching',path:'/matching/offers/active',token,signal})).data)}
  async detail(token:string,offerId:string,signal?:AbortSignal){return offer((await this.http.send({service:'matching',path:'/matching/offers/'+id(offerId),token,signal})).data)}
  async decide(token:string,offerId:string,key:string,action:'accept'|'decline'){
    const r=await this.http.send({service:'matching',path:`/matching/offers/${id(offerId)}/${action}`,method:'POST',body:{},token,key});
    const d=record(r.data);if(d.offerId!==id(offerId)||d.accepted!==(action==='accept')||d.status!==(action==='accept'?'ASSIGNMENT_PENDING':'DECLINED'))throw new BackendError('INVALID_RESPONSE');return {offerId:id(d.offerId),status:text(d.status),accepted:d.accepted};
  }
}
export class CustomerTripApi {
  constructor(private readonly http:BackendHttp){}
  estimate(token:string,pickup:Point,destination:Point,vehicleType:string,signal?:AbortSignal){return this.http.send({service:'trip',path:'/trips/estimate',method:'POST',body:{pickup,destination,vehicleType},token,signal})}
  create(token:string,quoteId:string,key:string){return this.http.send({service:'trip',path:'/trips',method:'POST',body:{quoteId:id(quoteId)},token,key})}
  active(token:string,signal?:AbortSignal){return this.http.send({service:'trip',path:'/trips/active',token,signal})}
  detail(token:string,tripId:string,signal?:AbortSignal){return this.http.send({service:'trip',path:'/trips/'+id(tripId),token,signal})}
  history(token:string,cursor?:string,status?:'COMPLETED'|'CANCELLED'){return this.http.send({service:'trip',path:'/trips/history',token,query:{limit:'20',...(cursor?{cursor}:{}),...(status?{status}:{})}})}
  cancel(token:string,tripId:string,version:number,reason:string,key:string){return this.http.send({service:'trip',path:'/trips/'+id(tripId)+'/cancel',method:'POST',body:{version,reason},token,key})}
}
export class PreviewApi {
  constructor(private readonly http:BackendHttp){}
  route(token:string,origin:Point,destination:Point,vehicleType:string,signal?:AbortSignal){return this.http.send({service:'routing',path:'/routes',method:'POST',body:{origin,destination,vehicleType,includeSteps:true},token,signal})}
  recalculate(token:string,currentLocation:Point,destination:Point,vehicleType:string,signal?:AbortSignal){return this.http.send({service:'routing',path:'/routes/recalculate',method:'POST',body:{currentLocation,destination,vehicleType,includeSteps:true},token,signal})}
}
