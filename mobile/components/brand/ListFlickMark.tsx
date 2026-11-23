import React from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';

interface ListFlickMarkProps {
  size?: number;
  style?: StyleProp<ImageStyle>;
}

export const ListFlickMark: React.FC<ListFlickMarkProps> = ({ size = 48, style }) => {
  return (
    <Image
      source={require('@/assets/images/logo-mark.png')}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="ListFlick logo mark"
    />
  );
};
