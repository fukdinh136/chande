import type { TextStyle } from 'react-native';

// Design system "Velox" từ thiết kế Stitch (DESIGN.md + cấu hình Tailwind của màn hình xuất ra).
export const colors = {
  surface: '#F8F9FF',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#EFF4FF',
  surfaceContainer: '#E5EEFF',
  surfaceContainerHigh: '#DCE9FF',
  surfaceContainerHighest: '#D3E4FE',
  onSurface: '#0B1C30',
  onSurfaceVariant: '#3D4947',
  outline: '#6D7A77',
  outlineVariant: '#BCC9C6',
  inverseSurface: '#213145',
  inverseOnSurface: '#EAF1FF',
  primary: '#00685F',
  onPrimary: '#FFFFFF',
  primaryContainer: '#008378',
  primaryFixed: '#89F5E7',
  onPrimaryFixed: '#00201D',
  secondary: '#565E74',
  secondaryFixed: '#DAE2FD',
  tertiary: '#006B2D',
  tertiaryFixed: '#71FE91',
  tertiaryFixedDim: '#52E078',
  onTertiaryFixed: '#002109',
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#93000A',
  // Màu chức năng trong DESIGN.md
  slate: '#0F172A',
  slateMuted: '#64748B',
  raised: '#F1F5F9',
  hairline: '#E2E8F0',
  route: '#0D9488',
  ghostBorder: 'rgba(15, 23, 42, 0.08)',
  scrim: 'rgba(11, 28, 48, 0.45)',
} as const;

export type StatusTone = 'searching' | 'enroute' | 'completed' | 'cancelled';
export const statusColors: Record<StatusTone, { text: string; background: string; dot: string }> = {
  searching: { text: '#D97706', background: '#FEF3C7', dot: '#F59E0B' },
  enroute: { text: '#0F766E', background: '#CCFBF1', dot: '#0D9488' },
  completed: { text: '#065F46', background: '#D1FAE5', dot: '#10B981' },
  cancelled: { text: '#BE123C', background: '#FFE4E6', dot: '#F43F5E' },
};

export const radius = { sm: 8, md: 16, lg: 24, xl: 32, full: 9999 } as const;
export const space = { xs: 4, sm: 8, md: 12, gutter: 16, lg: 20, xl: 28 } as const;

// React Native 0.76+ (New Architecture) hỗ trợ boxShadow kiểu CSS trên cả iOS, Android và web.
export const shadows = {
  card: '0 4px 12px -2px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.03)',
  raised: '0 8px 20px -6px rgba(15, 23, 42, 0.14), 0 2px 6px -1px rgba(15, 23, 42, 0.05)',
  sheet: '0 -8px 28px -6px rgba(15, 23, 42, 0.12), 0 -2px 8px -2px rgba(15, 23, 42, 0.04)',
  float: '0 10px 25px -5px rgba(13, 148, 136, 0.25), 0 8px 10px -6px rgba(15, 23, 42, 0.1)',
  soft: '0 1px 8px rgba(0, 0, 0, 0.04)',
} as const;

export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;
export type FontWeightName = keyof typeof fontFamily;
export const fontWeightValue: Record<FontWeightName, TextStyle['fontWeight']> = {
  regular: '400', medium: '500', semibold: '600', bold: '700',
};

export type TextVariant =
  | 'display-lg' | 'headline-lg' | 'headline-lg-mobile' | 'headline-md' | 'headline-sm' | 'title-md'
  | 'body-lg' | 'body-md' | 'body-sm' | 'label-lg' | 'label-md' | 'label-sm';

// letterSpacing của React Native tính theo point: đổi từ em trong DESIGN.md.
export const typography: Record<TextVariant, { weight: FontWeightName; fontSize: number; lineHeight: number; letterSpacing: number }> = {
  'display-lg': { weight: 'bold', fontSize: 40, lineHeight: 48, letterSpacing: -0.8 },
  'headline-lg': { weight: 'bold', fontSize: 32, lineHeight: 38, letterSpacing: -0.64 },
  'headline-lg-mobile': { weight: 'bold', fontSize: 26, lineHeight: 32, letterSpacing: -0.39 },
  'headline-md': { weight: 'semibold', fontSize: 22, lineHeight: 28, letterSpacing: -0.22 },
  'headline-sm': { weight: 'semibold', fontSize: 18, lineHeight: 24, letterSpacing: -0.09 },
  'title-md': { weight: 'semibold', fontSize: 16, lineHeight: 22, letterSpacing: 0 },
  'body-lg': { weight: 'regular', fontSize: 16, lineHeight: 24, letterSpacing: 0 },
  'body-md': { weight: 'regular', fontSize: 14, lineHeight: 20, letterSpacing: 0 },
  'body-sm': { weight: 'regular', fontSize: 12, lineHeight: 16, letterSpacing: 0.12 },
  'label-lg': { weight: 'semibold', fontSize: 14, lineHeight: 18, letterSpacing: 0.14 },
  'label-md': { weight: 'semibold', fontSize: 12, lineHeight: 16, letterSpacing: 0.24 },
  'label-sm': { weight: 'bold', fontSize: 10, lineHeight: 12, letterSpacing: 0.4 },
};
