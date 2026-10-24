/**
 * The manager approval inside the void and refund dialogs (the look of W1's
 * checkout approval): pick who approves, then their PIN. The dialog's own
 * submit button sends the request with `authorization`.
 */
import { ArrowLeftIcon, ShieldCheckIcon } from 'lucide-react';

import { Banner } from '@/components/common/Banner';
import { FormField } from '@/components/common/FormField';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ApproverPicker as ApproverPickerState } from '@/hooks/useApproverPicker';

type ApproverPickerProps = {
  picker: ApproverPickerState;
  /** "void" / "refund": the question and the empty message. */
  action: 'void' | 'refund';
  disabled: boolean;
};

export function ApproverPicker({ picker, action, disabled }: ApproverPickerProps) {
  const { approval } = picker;

  return (
    <section aria-label="Manager approval" className="flex flex-col gap-3 rounded-lg border border-warning-border bg-warning-bg p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheckIcon className="size-4 text-warning" aria-hidden="true" />
        {approval.reason ?? `A manager must approve this ${action}.`}
      </p>

      {approval.step === 'pin' && approval.approver ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{approval.approver.name}</p>
            <Button variant="ghost" size="sm" onClick={picker.backToApprovers} disabled={disabled}>
              <ArrowLeftIcon aria-hidden="true" />
              Choose someone else
            </Button>
          </div>
          <FormField label={`${approval.approver.name}'s PIN`} error={approval.error}>
            <Input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={approval.pin}
              onChange={(event) => picker.setPin(event.target.value)}
              disabled={disabled}
              className="h-12 max-w-56 text-center text-2xl tracking-[0.5em]"
            />
          </FormField>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {approval.error ? <Banner>{approval.error}</Banner> : null}
          <p className="text-sm">Who approves this {action}?</p>
          {picker.approversLoading ? (
            <LoadingRows rows={2} className="p-0" />
          ) : picker.approversError ? (
            <ErrorState message={picker.approversError} onRetry={picker.retryApprovers} />
          ) : picker.approvers.length === 0 ? (
            <Banner variant="warning">Nobody on this branch with a PIN can approve a {action}. Ask a manager to do it.</Banner>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {picker.approvers.map((person) => (
                <li key={person.id}>
                  <Button
                    variant="outline"
                    className="h-auto w-full justify-start py-3"
                    onClick={() => picker.chooseApprover(person)}
                    disabled={disabled}
                  >
                    <span className="flex flex-col items-start">
                      <span className="font-semibold">{person.name}</span>
                      <span className="text-[13px] text-muted-foreground">{person.role.name}</span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
