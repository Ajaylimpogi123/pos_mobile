/**
 * The MASTER §4 error summary: after a failed submit, a focusable box at the
 * top of the form lists every field with a message and links to it.
 *
 * Put it as the first child of a `<form>`. It reads the form itself, so the
 * fields need nothing extra: every control marked `aria-invalid="true"` (as
 * `FormField` does for a client check or a 422) is listed with its label and
 * its message (`#<id>-error`, the `FormField` / `FieldError` convention).
 * It shows only after a submit, and takes focus when the messages of that
 * submit appear (right away for a client check, later for a server 422).
 */
import { CircleAlertIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';

import { cn } from '@/lib/utils';

type SummaryItem = { id: string; label: string; message: string };

const FALLBACK_MESSAGE = 'Check this field.';

function textOf(element: Element | null | undefined): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function labelOf(control: HTMLElement): string {
  const labels = 'labels' in control ? (control as HTMLInputElement).labels : null;
  const fromLabel = labels && labels.length > 0 ? textOf(labels[0]) : '';
  return fromLabel || control.getAttribute('aria-label') || '';
}

function messageOf(control: HTMLElement): string {
  const own = document.getElementById(`${control.id}-error`);
  if (own) return textOf(own);
  const described = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id.endsWith('-error'));
  for (const id of described) {
    const text = textOf(document.getElementById(id));
    if (text) return text;
  }
  return FALLBACK_MESSAGE;
}

function scan(form: HTMLFormElement, self: HTMLElement): SummaryItem[] {
  const items: SummaryItem[] = [];
  for (const control of form.querySelectorAll<HTMLElement>('[aria-invalid="true"]')) {
    if (self.contains(control) || !control.id) continue;
    items.push({ id: control.id, label: labelOf(control), message: messageOf(control) });
  }
  return items;
}

function sameItems(a: SummaryItem[], b: SummaryItem[]): boolean {
  return a.length === b.length && a.every((item, index) => item.id === b[index].id && item.message === b[index].message && item.label === b[index].label);
}

export function ErrorSummary({ title = 'Please fix the following', className }: { title?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const awaitingFocus = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  const [items, setItems] = useState<SummaryItem[]>([]);

  useEffect(() => {
    const self = ref.current;
    const form = self?.closest('form');
    if (!self || !form) return;

    function refresh() {
      if (!self || !form) return;
      const next = scan(form, self);
      setItems((current) => (sameItems(current, next) ? current : next));
    }
    function onSubmit() {
      awaitingFocus.current = true;
      setSubmitted(true);
      // The client checks render in the same tick; read them once they have.
      window.setTimeout(refresh, 0);
    }

    const observer = new MutationObserver(refresh);
    observer.observe(form, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-invalid'] });
    form.addEventListener('submit', onSubmit, true);
    return () => {
      observer.disconnect();
      form.removeEventListener('submit', onSubmit, true);
    };
  }, []);

  const visible = submitted && items.length > 0;

  useEffect(() => {
    if (visible && awaitingFocus.current) {
      awaitingFocus.current = false;
      ref.current?.focus();
    }
  }, [visible, items]);

  function jumpTo(event: MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault();
    const control = document.getElementById(id);
    control?.focus();
    control?.scrollIntoView({ block: 'center' });
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      hidden={!visible}
      aria-labelledby={visible ? titleId : undefined}
      className={cn('rounded-lg border border-danger-border bg-danger-bg px-3 py-2.5 text-sm text-danger', className)}
    >
      {visible ? (
        <div className="flex items-start gap-3">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p id={titleId} className="font-semibold">
              {title}
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {items.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} onClick={(event) => jumpTo(event, item.id)} className="font-medium underline underline-offset-2">
                    {item.label ? `${item.label}: ` : ''}
                    {item.message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
