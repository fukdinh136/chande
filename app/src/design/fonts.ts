import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';

// Nạp riêng 4 độ đậm của Inter mà thiết kế dùng, thay vì cả họ font.
let systemFallback = false;
export const usesSystemFont = () => systemFallback;

/** Trả về true khi có thể vẽ chữ: Inter đã nạp, hoặc nạp lỗi và chuyển sang font hệ thống. */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (error) systemFallback = true;
    if (loaded || error) setReady(true);
  }, [loaded, error]);
  return ready;
}
