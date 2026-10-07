import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Linking } from 'react-native';

import { ImageTooSmallError, prepareImageForUpload, type PreparedImage } from '@/utils/image';

export type ImageSource = 'library' | 'camera';

export const CAMERA_DENIED_MESSAGE =
  'Camera access is off for POS Mobile. To take a photo, allow camera access in your device Settings.';
export const LIBRARY_FAILED_MESSAGE =
  "Couldn't open your photos. If photo access is off for POS Mobile, allow it in your device Settings.";
export const PROCESS_FAILED_MESSAGE = "Couldn't prepare that image. Please try another photo.";

/** Picker options: images only, with the platform's crop/rotate step, full quality (we compress after resizing). */
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [4, 3],
  quality: 1,
};

/**
 * Picks a photo from the library or the camera, then downscales it for upload.
 * - Library: the system photo picker needs no permission prompt (SDK 57 docs).
 * - Camera: asks for camera permission first; a denial shows a friendly
 *   message with a Settings hint (`openSettings`).
 * Resolves `null` when the user cancels or something failed (see `error`).
 */
export function useImagePicker() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettingsHint, setShowSettingsHint] = useState(false);
  const inFlight = useRef(false);

  function clearError() {
    setError(null);
    setShowSettingsHint(false);
  }

  async function pick(source: ImageSource): Promise<PreparedImage | null> {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    clearError();

    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError(CAMERA_DENIED_MESSAGE);
          setShowSettingsHint(true);
          return null;
        }
      }

      let result: ImagePicker.ImagePickerResult;
      try {
        result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
            : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
      } catch {
        setError(source === 'camera' ? CAMERA_DENIED_MESSAGE : LIBRARY_FAILED_MESSAGE);
        setShowSettingsHint(true);
        return null;
      }

      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return null;

      try {
        return await prepareImageForUpload(asset);
      } catch (processError) {
        setError(processError instanceof ImageTooSmallError ? processError.message : PROCESS_FAILED_MESSAGE);
        return null;
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function openSettings() {
    void Linking.openSettings();
  }

  return { pick, busy, error, showSettingsHint, clearError, openSettings };
}

export type ImagePickerState = ReturnType<typeof useImagePicker>;
