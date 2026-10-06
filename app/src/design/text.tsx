import { StyleSheet, Text, type TextProps } from 'react-native';
import { usesSystemFont } from './fonts';
import { colors, fontFamily, fontWeightValue, typography, type FontWeightName, type TextVariant } from './tokens';

export interface TxtProps extends TextProps {
  variant?: TextVariant;
  color?: string;
  weight?: FontWeightName;
  /** Chữ số đều độ rộng cho giá tiền, thời gian, biển số (DESIGN.md: "Numerical Glanceability"). */
  tabular?: boolean;
  align?: 'left' | 'center' | 'right';
  uppercase?: boolean;
}

export function Txt({ variant = 'body-md', color = colors.onSurface, weight, tabular, align, uppercase, style, ...rest }: TxtProps) {
  const spec = typography[variant];
  const resolvedWeight = weight ?? spec.weight;
  const font = usesSystemFont()
    ? { fontWeight: fontWeightValue[resolvedWeight] }
    : { fontFamily: fontFamily[resolvedWeight] };
  return (
    <Text
      {...rest}
      style={[
        { fontSize: spec.fontSize, lineHeight: spec.lineHeight, letterSpacing: spec.letterSpacing, color },
        font,
        tabular && styles.tabular,
        align && { textAlign: align },
        uppercase && styles.uppercase,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
  uppercase: { textTransform: 'uppercase' },
});
