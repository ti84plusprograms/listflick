import React from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';
import { getActiveColorScheme, theme } from '@/constants/theme';

interface ListFlickMarkProps {
  size?: number;
  style?: StyleProp<ImageStyle>;
}

/** The mark is black on a transparent background; in dark mode it is drawn in the light text color. */
export function logoTintColor(): string | undefined {
  return getActiveColorScheme() === 'dark' ? theme.colors.textPrimary : undefined;
}

export const ListFlickMark: React.FC<ListFlickMarkProps> = ({ size = 48, style }) => {
  const tintColor = logoTintColor();
  return (
    <Image
      source={require('@/assets/images/logo-mark.png')}
      style={[{ width: size, height: size }, tintColor ? { tintColor } : null, style]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="ListFlick logo mark"
    />
  );
};
