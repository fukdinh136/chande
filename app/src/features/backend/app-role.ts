import Constants from 'expo-constants';
import {applicationId} from 'expo-application';
export function appRole(): 'customer'|'driver'|'combined' {
  const value=applicationId==='com.chande.customer'?'customer':applicationId==='com.chande.driver'?'driver':Constants.expoConfig?.extra?.appRole;
  return value==='customer'||value==='driver'?value:'combined';
}
