import {useState} from 'react';
import {View} from 'react-native';
import {Action} from '../ui/components';
import {CustomerProfileForm} from './profile-form';
import {CustomerSecurityForm} from './security-form';
import {CustomerPlacesPanel} from './places-panel';
import type {SavedPlace} from './places';

export function CustomerAccount({select}: {select: (place: SavedPlace, kind: 'pickup' | 'destination') => void}) {
  const [section, setSection] = useState('profile');
  return <>
    <View accessibilityRole="tablist" style={{gap: 8}}>{[{value: 'profile', label: 'Hồ sơ'}, {value: 'places', label: 'Địa chỉ yêu thích'}, {value: 'security', label: 'Bảo mật'}].map(item => <Action key={item.value} role="tab" selected={section === item.value} label={`${section === item.value ? 'Đang chọn · ' : ''}${item.label}`} variant={section === item.value ? 'primary' : 'secondary'} onPress={() => setSection(item.value)}/>)}</View>
    {section === 'profile' ? <CustomerProfileForm/> : section === 'places' ? <CustomerPlacesPanel select={select}/> : <CustomerSecurityForm/>}
  </>;
}
