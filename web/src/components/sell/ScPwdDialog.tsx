/**
 * The SC/PWD dialog (Senior Citizen / PWD Discount → Device rules): persons
 * (type + OSCA/PWD ID), mode (Their items: tick the lines; Shared meal: the
 * diners), and **VAT exempt** (unticked by default). Applying over discounts
 * SC/PWD can't be combined with asks to remove them first. No approval, ever.
 */
import { PlusIcon, XIcon } from 'lucide-react';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FieldError } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/misc';
import type { ScPwdEditor } from '@/hooks/sell/useScPwdEditor';
import { describeConflicts, SC_PWD_LIMITS, SC_PWD_MODES, SC_PWD_PERSON_TYPES, VAT_EXEMPT_HINT } from '@pos/core/sale/scPwd';
import { useActiveCartStore } from '@/stores/cart';
import { formatPeso } from '@pos/core/money';

import { QtyStepper, Segmented } from './SellParts';

export function ScPwdDialog({ editor }: { editor: ScPwdEditor }) {
  const draft = editor.draft;
  const useStore = useActiveCartStore();
  const lines = useStore((state) => state.lines);
  const hasScPwd = useStore((state) => state.scPwd !== null);
  const serverErrors = useStore((state) => state.scPwdErrors);

  return (
    <>
      <Dialog open={draft !== null && editor.pending === null} onOpenChange={(open) => (open ? null : editor.close())}>
        <DialogContent className="max-w-2xl">
          {draft ? (
            <form
              className="flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                editor.apply();
              }}
            >
              <ErrorSummary />
              <DialogHeader>
                <DialogTitle>Senior citizen / PWD</DialogTitle>
                <DialogDescription>20% off the eligible part of the sale. Record each person's ID number.</DialogDescription>
              </DialogHeader>

              {serverErrors[''] ? <Banner>{serverErrors['']}</Banner> : null}

              <fieldset className="flex flex-col gap-3">
                <legend className="mb-2 flex w-full items-center justify-between text-sm font-semibold">
                  Persons
                  <span className="font-normal text-muted-foreground tabular">
                    {draft.persons.length} of {SC_PWD_LIMITS.maxPersons}
                  </span>
                </legend>
                {draft.persons.map((person, index) => {
                  const error = editor.errors?.persons[person.key] ?? serverErrors[`persons.${index}.id_no`] ?? null;
                  const inputId = `sc-pwd-id-${person.key}`;
                  return (
                    <div key={person.key} className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
                      <Segmented
                        label={`Person ${index + 1}`}
                        value={person.type}
                        options={SC_PWD_PERSON_TYPES}
                        onChange={(type) => editor.setPersonType(person.key, type)}
                      />
                      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                        <Label htmlFor={inputId}>{person.type === 'pwd' ? 'PWD ID number' : 'OSCA ID number'}</Label>
                        <Input
                          id={inputId}
                          value={person.idNo}
                          maxLength={SC_PWD_LIMITS.idNoMax}
                          autoComplete="off"
                          onChange={(event) => editor.setPersonId(person.key, event.target.value)}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? `${inputId}-error` : undefined}
                        />
                        <FieldError id={`${inputId}-error`} message={error} />
                      </div>
                      {draft.persons.length > 1 ? (
                        <Button variant="ghost" size="icon" onClick={() => editor.removePerson(person.key)} aria-label={`Remove person ${index + 1}`}>
                          <XIcon aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
                {draft.persons.length < SC_PWD_LIMITS.maxPersons ? (
                  <Button variant="outline" className="w-fit" onClick={editor.addPerson}>
                    <PlusIcon aria-hidden="true" />
                    Add person
                  </Button>
                ) : null}
              </fieldset>

              <Segmented label="Discount applies to" value={draft.mode} options={SC_PWD_MODES} onChange={editor.setMode} />

              {draft.mode === 'items' ? (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-semibold">Tick the items for the senior citizen or PWD</legend>
                  <ul className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {lines.map((line) => {
                      const id = `sc-pwd-line-${line.key}`;
                      const checked = draft.markedKeys.includes(line.key);
                      return (
                        <li key={line.key} className="flex items-center gap-3 px-3 py-2.5">
                          <Checkbox id={id} checked={checked} onCheckedChange={() => editor.toggleLine(line.key)} />
                          <Label htmlFor={id} className="flex-1 font-normal">
                            {line.qty} x {line.product.name}
                            {line.discount ? <span className="text-[13px] text-warning"> · its discount is removed if ticked</span> : null}
                          </Label>
                          <span className="text-sm tabular">{formatPeso(line.product.price_cents * line.qty)}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <FieldError message={editor.errors?.lines ?? null} />
                </fieldset>
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-semibold" id="sc-pwd-diners-label">
                    Diners sharing the bill
                  </span>
                  <QtyStepper
                    value={draft.diners}
                    onChange={editor.setDiners}
                    min={Math.max(1, draft.persons.length)}
                    max={SC_PWD_LIMITS.maxDiners}
                    label="diners"
                  />
                  <FieldError message={editor.errors?.diners ?? serverErrors.diners ?? null} />
                  <p className="text-[13px] text-info">Other discounts are removed for a shared meal.</p>
                </div>
              )}

              <div className="flex items-start gap-3">
                <Checkbox id="sc-pwd-vat" checked={draft.vatExempt} onCheckedChange={(value) => editor.setVatExempt(value === true)} />
                <div className="flex flex-col">
                  <Label htmlFor="sc-pwd-vat">VAT exempt</Label>
                  <span className="text-[13px] text-muted-foreground">{VAT_EXEMPT_HINT}</span>
                </div>
              </div>

              <DialogFooter className="sm:justify-between">
                {hasScPwd ? (
                  <Button variant="destructive" onClick={editor.remove}>
                    Remove SC/PWD
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button variant="outline" onClick={editor.close}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="green" size="lg">
                    Apply
                  </Button>
                </div>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={editor.pending !== null} onOpenChange={(open) => (open ? null : editor.cancelRemoval())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove the other discounts?</DialogTitle>
            <DialogDescription>{editor.pending ? describeConflicts(editor.pending.conflicts) : ''}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={editor.cancelRemoval}>
              Go back
            </Button>
            <Button variant="green" size="lg" onClick={editor.confirmRemoval}>
              Remove and apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
