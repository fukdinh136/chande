import { useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { usesSystemFont } from './fonts';
import { Txt } from './text';
import { colors, fontFamily, radius, space } from './tokens';

export interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
  trailing?: ReactNode;
}

export function TextField({ label, error, hint, trailing, style, onFocus, onBlur, ...props }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.error : focused ? colors.primary : colors.hairline;
  return (
    <View style={styles.field}>
      <Txt variant="label-md" color={colors.onSurfaceVariant}>{label}</Txt>
      <View style={[styles.box, { borderColor }]}>
        <TextInput
          {...props}
          accessibilityLabel={label}
          placeholderTextColor={colors.slateMuted}
          onFocus={(event) => { setFocused(true); onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
          style={[styles.input, usesSystemFont() ? styles.systemFont : styles.interFont, props.multiline && styles.multiline, style]}
        />
        {trailing}
      </View>
      {error ? <Txt variant="body-sm" color={colors.error} accessibilityLiveRegion="polite">{error}</Txt>
        : hint ? <Txt variant="body-sm" color={colors.slateMuted}>{hint}</Txt> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  box: {
    minHeight: 52, borderWidth: 1, borderRadius: radius.md, backgroundColor: colors.surfaceContainerLowest,
    flexDirection: 'row', alignItems: 'center', paddingRight: space.xs,
  },
  input: { flex: 1, minHeight: 50, paddingHorizontal: 14, fontSize: 16, color: colors.onSurface },
  interFont: { fontFamily: fontFamily.medium },
  systemFont: { fontWeight: '500' },
  multiline: { paddingVertical: 12, minHeight: 88, textAlignVertical: 'top' },
});
