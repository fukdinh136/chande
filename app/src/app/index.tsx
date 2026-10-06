import {Link,Redirect} from 'expo-router';
import {appRole} from '@/features/backend/app-role';
import {ThemedText} from '@/components/themed-text';
import {Screen,Notice} from '@/features/driver/components/ui';
export default function HomeScreen(){
  const role=appRole();if(role==='customer')return <Redirect href="/customer"/>;if(role==='driver')return <Redirect href="/driver"/>;
  return <Screen title="Velox · Demo Hà Nội"><Notice>Chọn ứng dụng để kết nối backend local.</Notice><Link href="/customer"><ThemedText type="linkPrimary">Khách hàng · Đặt xe</ThemedText></Link><Link href="/driver"><ThemedText type="linkPrimary">Tài xế · Nhận cuốc</ThemedText></Link></Screen>;
}
