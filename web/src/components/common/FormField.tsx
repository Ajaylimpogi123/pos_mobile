/**
 * A labelled form field with its 422 message underneath (MASTER §4: every
 * input has a visible label; each message sits under its field via
 * `aria-describedby`). The message's id is `<control id>-error`: the form's
 * `ErrorSummary` reads it to list and link the fields after a failed submit.
 */
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type FieldControlProps = {
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

type FormFieldProps = {
  label: string;
  /** The field's message (a 422 or a client check). */
  error?: string | null;
  hint?: ReactNode;
  className?: string;
  /** One input-like element; it gets the id, `aria-invalid` and `aria-describedby`. */
  children: ReactElement<FieldControlProps>;
};

export function FormField({ label, error, hint, className, children }: FormFieldProps) {
  const generated = useId();
  const id = children.props.id ?? generated;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })
    : children;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {control}
      {hint ? (
        <p id={hintId} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function FieldError({ id, message }: { id?: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="text-[13px] font-medium text-danger">
      {message}
    </p>
  );
}
