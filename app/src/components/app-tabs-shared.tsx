import {Tabs} from '@/features/ui/design';
export default function AppTabs({value,onChange,driver=false}:{value:string;onChange:(value:string)=>void;driver?:boolean}){
  return <Tabs value={value} onChange={onChange} items={driver?[{key:'home',label:'Nhận chuyến',icon:'navigate-outline'},{key:'history',label:'Lịch sử',icon:'receipt-outline'},{key:'profile',label:'Hồ sơ',icon:'person-outline'}]:[{key:'home',label:'Đặt xe',icon:'navigate-outline'},{key:'history',label:'Lịch sử',icon:'receipt-outline'},{key:'account',label:'Tài khoản',icon:'person-outline'}]}/>;
}
