/**
 * The image of a category or product (Global Conventions → File uploads):
 * pick a JPEG, PNG or WebP, which is checked and downscaled in the browser
 * (`@/utils/images`) and uploaded on Save, after the JSON; or remove the
 * current image. The current image loads the way the Sell screen loads it
 * (`catalogImageSrc`: same-origin `/storage/…`, or `VITE_IMAGE_ORIGIN`).
 */
import { ImageIcon, ImageOffIcon, LoaderCircleIcon, UndoIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { FieldError } from '@/components/common/FormField';
import { catalogImageSrc } from '@/components/sell/SellParts';
import { Button } from '@/components/ui/button';
import type { ImageChange } from '@/hooks/useCatalogAdmin';
import { IMAGE_ACCEPT, prepareImage } from '@/utils/images';

type ImageFieldProps = {
  label: string;
  imageUrl: string | null;
  imagePath: string | null;
  value: ImageChange;
  onChange: (change: ImageChange) => void;
  /** File name stem sent to the server, e.g. `product-7`. */
  baseName: string;
  /** A server message for the image (e.g. a failed upload). */
  error?: string | null;
  disabled?: boolean;
};

function readDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

export function ImageField({ label, imageUrl, imagePath, value, onChange, baseName, error, disabled = false }: ImageFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const current = catalogImageSrc(imageUrl, imagePath);
  const shown = value.kind === 'upload' ? preview : value.kind === 'remove' ? null : current;

  async function onPick(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setPreparing(true);
    try {
      const image = await prepareImage(file, baseName);
      setPreview(await readDataUrl(image.blob));
      onChange({ kind: 'upload', image });
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : "This image couldn't be used.");
    } finally {
      setPreparing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium" id={`${inputId}-label`}>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-tile">
          {shown ? (
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={IMAGE_ACCEPT}
            className="sr-only"
            aria-labelledby={`${inputId}-label`}
            disabled={disabled || preparing}
            onChange={(event) => void onPick(event.target.files?.[0])}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={disabled || preparing} onClick={() => inputRef.current?.click()}>
              {preparing ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
              {preparing ? 'Preparing…' : shown ? 'Replace image' : 'Choose image'}
            </Button>
            {value.kind !== 'none' ? (
              <Button type="button" variant="ghost" disabled={disabled} onClick={() => onChange({ kind: 'none' })}>
                <UndoIcon aria-hidden="true" />
                Undo
              </Button>
            ) : current ? (
              <Button type="button" variant="destructive" disabled={disabled} onClick={() => onChange({ kind: 'remove' })}>
                <ImageOffIcon aria-hidden="true" />
                Remove image
              </Button>
            ) : null}
          </div>
          <p className="text-[13px] text-muted-foreground">
            {value.kind === 'upload'
              ? 'The new image is uploaded when you save.'
              : value.kind === 'remove'
                ? 'The image is removed when you save.'
                : 'JPEG, PNG or WebP, at least 100×100 px, up to 5 MB.'}
          </p>
        </div>
      </div>
      <FieldError message={problem ?? error} />
    </div>
  );
}
