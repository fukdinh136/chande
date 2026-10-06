import * as SecureStore from 'expo-secure-store';
import {Platform} from 'react-native';
import {id,record} from './http';
import type {Command,CommandStorage} from './durable-command';
export function commandStorage(role:'customer'|'driver',base:string,actorId:string):CommandStorage {
  const key=`chande.${role}.pending.${id(actorId)}.${encodeURIComponent(base).replace(/[^A-Za-z0-9_.-]/g,'_')}`,scope=`${base}|${id(actorId)}`;let memory:string|null=null;
  return {
    async read(){
      const raw=Platform.OS==='web'?memory:await SecureStore.getItemAsync(key);if(!raw)return null;
      const value=record(JSON.parse(raw));if(value.scope!==scope)return null;
      const c=record(value.command);if(typeof c.operation!=='string')throw new Error('INVALID_COMMAND_STORAGE');
      return {key:id(c.key),operation:c.operation,body:record(c.body)};
    },
    async write(command:Command|null){
      const raw=command?JSON.stringify({scope,command}):null;
      if(Platform.OS==='web')memory=raw;else if(raw)await SecureStore.setItemAsync(key,raw);else await SecureStore.deleteItemAsync(key);
    },
  };
}
