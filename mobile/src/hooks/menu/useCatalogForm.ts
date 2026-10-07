import type { UseMutationResult } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { splitSaveError, type FieldErrors } from '@/hooks/forms/formErrors';
import { useConfirmAction } from '@/hooks/forms/useConfirmAction';
import { useFormFields } from '@/hooks/forms/useFormFields';
import { imageErrorMessage } from '@/hooks/menu/formErrors';
import { useImagePicker, type ImageSource } from '@/hooks/useImagePicker';
import { getErrorMessage, isApiError } from '@/services/api';
import type { UploadFile } from '@/services/types';
import { toUploadFile, type PreparedImage } from '@/utils/image';

/** Anything the catalogue forms edit: it has an id and an optional image. */
type CatalogRecord = { id: number; image_url: string | null };

type CatalogMutations<R extends CatalogRecord, C, U> = {
  create: UseMutationResult<R, unknown, C>;
  update: UseMutationResult<R, unknown, { id: number; body: U }>;
  uploadImage: UseMutationResult<R, unknown, { id: number; file: UploadFile }>;
  removeImage: UseMutationResult<R, unknown, number>;
  remove: UseMutationResult<void, unknown, number>;
};

export type CatalogFormConfig<V extends object, F extends string, R extends CatalogRecord, C, U extends object> = {
  /** The saved record when editing; `undefined` when creating. */
  initial: R | undefined;
  toValues: (record?: R) => V;
  /** Client-side checks mirroring the contract rules. `body` is `null` when there are errors. */
  validate: (values: V) => { body: C | null; errors: FieldErrors<F> };
  /** Only the fields that changed (PATCH is partial). */
  diff: (saved: R, body: C) => U;
  /** Request field names whose 422 messages show under an input. */
  fields: readonly F[];
  /** Which request field each form value feeds, so typing clears that field's error. */
  fieldOf: { [K in keyof V]: F };
  mutations: CatalogMutations<R, C, U>;
  /** File name (without extension) for the upload, e.g. `product-7`. */
  imageName: (id: number) => string;
  /** "product" / "category", for messages. */
  noun: string;
  onSaved: (record: R) => void;
  onDeleted: () => void;
  /**
   * An update's `409` that belongs to one field (e.g. §J's stock mode: "Use
   * up or write off the stock first."): the message also shows under it.
   */
  conflictField?: (changes: U) => F | null;
};

export type SaveStage = 'idle' | 'saving' | 'uploading';

/** What the image panel needs to render. */
export type ImagePanelState = {
  /** A local preview of the picked image, else the saved `image_url`, else `null`. */
  previewUri: string | null;
  /** A picked image is waiting for Save. */
  isPending: boolean;
  /** There is something to remove (a picked image, or a saved one). */
  canRemove: boolean;
  /** The picker / camera / resize step is running. */
  picking: boolean;
  /** An upload or delete of the image is in flight. */
  working: 'uploading' | 'removing' | null;
  error: string | null;
  showSettingsHint: boolean;
  choose: (source: ImageSource) => void;
  remove: () => void;
  openSettings: () => void;
};

/**
 * Shared state + submit flow for the product and category forms. It lives in
 * the form screen *above* every layout switch, so rotating never loses input.
 *
 * Save:
 * 1. Client-side validation (the server still validates everything).
 * 2. Create (POST) or update (PATCH, changed fields only; skipped when nothing changed).
 * 3. Then, if an image was picked, upload it (multipart) to the saved record.
 *    On create the record is always saved first, so the upload has an id.
 *    If the upload fails the record stays saved and the form switches to
 *    editing it, so pressing Save again retries only the upload.
 * 4. Invalidate the lists (in the mutations) and call `onSaved` (navigate back).
 *
 * Errors: 422 → under each field (and `image` under the image panel);
 * anything else (403 / 404 / 409 / 5xx / network) → the banner.
 */
export function useCatalogForm<V extends object, F extends string, R extends CatalogRecord, C, U extends object>(
  config: CatalogFormConfig<V, F, R, C, U>,
) {
  const { mutations } = config;
  const { values, setField, fieldErrors, setFieldErrors } = useFormFields<V, F>(
    () => config.toValues(config.initial),
    config.fieldOf,
  );
  const [saved, setSaved] = useState<R | null>(config.initial ?? null);
  const [pendingImage, setPendingImage] = useState<PreparedImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [stage, setStage] = useState<SaveStage>('idle');
  const [removeImageVisible, setRemoveImageVisible] = useState(false);
  const inFlight = useRef(false);
  const picker = useImagePicker();

  // Delete: a 409 (e.g. "This category still has products. …") shows in the banner, never a crash.
  const deleteDialog = useConfirmAction(
    async () => {
      if (!saved) return;
      await mutations.remove.mutateAsync(saved.id);
      config.onDeleted();
    },
    (error) => setBannerError(getErrorMessage(error)),
  );

  const removingImage = mutations.removeImage.isPending;
  const deleting = deleteDialog.busy;
  const submitting = stage !== 'idle';
  const busy = submitting || removingImage || deleting;

  async function chooseImage(source: ImageSource) {
    const image = await picker.pick(source);
    if (image) {
      setPendingImage(image);
      setImageError(null);
    }
  }

  function requestRemoveImage() {
    setImageError(null);
    // A picked-but-unsaved image is simply discarded; a saved one needs DELETE …/image.
    if (pendingImage) setPendingImage(null);
    else if (saved?.image_url) setRemoveImageVisible(true);
  }

  async function confirmRemoveImage() {
    if (!saved) return;
    try {
      const updated = await mutations.removeImage.mutateAsync(saved.id);
      setSaved(updated);
    } catch (error) {
      setImageError(imageErrorMessage(error));
    } finally {
      setRemoveImageVisible(false);
    }
  }

  async function submit() {
    if (inFlight.current || removingImage || deleting) return;
    setBannerError(null);
    setImageError(null);

    const { body, errors } = config.validate(values);
    if (!body) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    inFlight.current = true;

    let step: 'record' | 'image' = 'record';
    let current = saved;
    let sentChanges: U | null = null;
    try {
      if (!current) {
        setStage('saving');
        current = await mutations.create.mutateAsync(body);
        setSaved(current);
      } else {
        const changes = config.diff(current, body);
        if (Object.keys(changes).length > 0) {
          sentChanges = changes;
          setStage('saving');
          current = await mutations.update.mutateAsync({ id: current.id, body: changes });
          setSaved(current);
        }
      }

      if (pendingImage) {
        step = 'image';
        setStage('uploading');
        current = await mutations.uploadImage.mutateAsync({
          id: current.id,
          file: toUploadFile(pendingImage, config.imageName(current.id)),
        });
        setSaved(current);
        setPendingImage(null);
      }

      config.onSaved(current);
    } catch (error) {
      if (step === 'image') {
        const message = imageErrorMessage(error);
        setImageError(message);
        setBannerError(
          `The ${config.noun} was saved, but its image couldn't be uploaded: ${message} Press Save to try the upload again.`,
        );
      } else {
        const split = splitSaveError(error, config.fields);
        const conflict =
          isApiError(error) && error.status === 409 && sentChanges && config.conflictField ? config.conflictField(sentChanges) : null;
        setFieldErrors(conflict && split.banner ? { ...split.fieldErrors, [conflict]: split.banner } : split.fieldErrors);
        setBannerError(split.banner);
      }
    } finally {
      inFlight.current = false;
      setStage('idle');
    }
  }

  function requestDelete() {
    setBannerError(null);
    deleteDialog.request();
  }

  const image: ImagePanelState = {
    previewUri: pendingImage?.uri ?? saved?.image_url ?? null,
    isPending: pendingImage !== null,
    canRemove: pendingImage !== null || Boolean(saved?.image_url),
    picking: picker.busy,
    working: stage === 'uploading' ? 'uploading' : removingImage ? 'removing' : null,
    error: imageError ?? picker.error,
    showSettingsHint: picker.showSettingsHint && picker.error !== null,
    choose: (source) => void chooseImage(source),
    remove: requestRemoveImage,
    openSettings: picker.openSettings,
  };

  return {
    values,
    setField,
    fieldErrors,
    /** Show or clear field errors outside Save (e.g. a row of the ingredient units editor). */
    setFieldErrors,
    bannerError,
    dismissBanner: () => setBannerError(null),
    /** Editing an existing record (also true after a create whose image upload failed). */
    isEdit: saved !== null,
    saved,
    /** A fresher server copy from outside Save (e.g. §J "Use as product cost"), so the next PATCH diffs against it. */
    replaceSaved: (record: R) => setSaved(record),
    stage,
    submitting,
    busy,
    submit: () => void submit(),
    image,
    removeImageDialog: {
      visible: removeImageVisible,
      busy: removingImage,
      confirm: () => void confirmRemoveImage(),
      cancel: () => {
        if (!removingImage) setRemoveImageVisible(false);
      },
    },
    deleteDialog: { ...deleteDialog, request: requestDelete },
  };
}

export type CatalogFormState<V extends object, F extends string> = {
  values: V;
  setField: <K extends keyof V>(key: K, value: V[K]) => void;
  fieldErrors: FieldErrors<F>;
  busy: boolean;
};
