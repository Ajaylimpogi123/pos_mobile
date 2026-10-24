/** Bundled images (Metro resolves them to an image source; Jest via jest-expo). */
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';

  const source: ImageSourcePropType;
  export default source;
}
