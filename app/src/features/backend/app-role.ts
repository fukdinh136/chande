import Constants from 'expo-constants';
export function appRole(): 'customer'|'driver'|'combined' {
  const value=Constants.expoConfig?.extra?.appRole;
  return value==='customer'||value==='driver'?value:'combined';
}
