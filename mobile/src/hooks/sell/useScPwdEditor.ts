import { useState } from 'react';

import {
  hasConflicts,
  resolveScPwdDraft,
  SC_PWD_LIMITS,
  scPwdConflicts,
  type ScPwdConflicts,
  type ScPwdDraft,
  type ScPwdDraftErrors,
} from '@pos/core/sale/scPwd';
import type { ScPwdMode, ScPwdPersonType, ScPwdRequest } from '@/services/types';
import { useCartStoreApi, type CartStore } from '@/stores/cart';

/** SC/PWD checked and waiting for the cashier to confirm removing the discounts it can't be combined with. */
type PendingApply = {
  scPwd: ScPwdRequest;
  markedKeys: string[];
  conflicts: ScPwdConflicts;
};

/** The diners a new shared meal starts with (at least the persons count; the stepper changes it). */
const DEFAULT_DINERS = 2;

let nextPersonNumber = 1;

function personKey(): string {
  const key = `person-${nextPersonNumber}`;
  nextPersonNumber += 1;
  return key;
}

/** The draft of the cart's SC/PWD, or of a new one (one senior citizen, `Their items`, VAT exempt **unticked**). */
function draftFromCart(store: CartStore): ScPwdDraft {
  const { scPwd, lines } = store.getState();
  if (!scPwd) {
    return {
      mode: 'items',
      persons: [{ key: personKey(), type: 'senior_citizen', idNo: '' }],
      diners: DEFAULT_DINERS,
      vatExempt: false,
      markedKeys: [],
    };
  }
  return {
    mode: scPwd.mode,
    persons: scPwd.persons.map((person) => ({ key: personKey(), type: person.type, idNo: person.id_no })),
    diners: scPwd.diners ?? Math.max(DEFAULT_DINERS, scPwd.persons.length),
    vatExempt: scPwd.vat_exempt,
    markedKeys: lines.filter((line) => line.scPwd).map((line) => line.key),
  };
}

/**
 * The SC/PWD sheet's state (Senior Citizen / PWD Discount → Device rules):
 * the persons (type + ID number), the mode, the diners of a shared meal, the
 * VAT exempt checkbox and, in `items` mode, the ticked cart lines. The draft
 * is applied to the cart only on **Apply**, after the contract's checks; when
 * the cart has discounts SC/PWD can't be combined with, the cashier confirms
 * removing them first. It lives above every layout switch (the Sell screen,
 * the checkout), so rotating keeps what was typed.
 */
export function useScPwdEditor() {
  const useCartStore = useCartStoreApi();
  const [draft, setDraft] = useState<ScPwdDraft | null>(null);
  const [errors, setErrors] = useState<ScPwdDraftErrors | null>(null);
  const [pending, setPending] = useState<PendingApply | null>(null);

  function change(update: (current: ScPwdDraft) => ScPwdDraft) {
    setDraft((current) => (current ? update(current) : current));
    setErrors(null);
  }

  function open() {
    if (useCartStore.getState().awaitingConfirmation) return;
    setDraft(draftFromCart(useCartStore));
    setErrors(null);
    setPending(null);
  }

  function close() {
    setDraft(null);
    setErrors(null);
    setPending(null);
  }

  function commit(apply: Pick<PendingApply, 'scPwd' | 'markedKeys'>) {
    useCartStore.getState().applyScPwd(apply.scPwd, apply.markedKeys);
    close();
  }

  function apply() {
    if (!draft) return;
    const { lines, orderDiscount } = useCartStore.getState();
    const resolved = resolveScPwdDraft(
      draft,
      lines.map((line) => line.key),
    );
    if (resolved.errors) {
      setErrors(resolved.errors);
      return;
    }
    const conflicts = scPwdConflicts(lines, orderDiscount, resolved.scPwd.mode, new Set(resolved.markedKeys));
    if (hasConflicts(conflicts)) {
      setPending({ scPwd: resolved.scPwd, markedKeys: resolved.markedKeys, conflicts });
      return;
    }
    commit(resolved);
  }

  function confirmRemoval() {
    if (pending) commit(pending);
  }

  function remove() {
    useCartStore.getState().removeScPwd();
    close();
  }

  return {
    /** `null` while the sheet is closed. */
    draft,
    /** The last Apply's problems (cleared by the next change). */
    errors,
    /** The discounts to remove, while the confirmation is showing. */
    pending,
    open,
    close,
    apply,
    confirmRemoval,
    cancelRemoval: () => setPending(null),
    /** Removes the cart's SC/PWD (and every line mark). */
    remove,
    setMode: (mode: ScPwdMode) =>
      change((current) => ({ ...current, mode, diners: Math.max(current.diners, current.persons.length) })),
    setVatExempt: (vatExempt: boolean) => change((current) => ({ ...current, vatExempt })),
    setDiners: (diners: number) =>
      change((current) => ({
        ...current,
        diners: Math.min(SC_PWD_LIMITS.maxDiners, Math.max(Math.max(1, current.persons.length), Math.trunc(diners))),
      })),
    addPerson: () =>
      change((current) => {
        if (current.persons.length >= SC_PWD_LIMITS.maxPersons) return current;
        const persons = [...current.persons, { key: personKey(), type: 'senior_citizen' as ScPwdPersonType, idNo: '' }];
        return { ...current, persons, diners: Math.max(current.diners, persons.length) };
      }),
    removePerson: (key: string) =>
      change((current) =>
        current.persons.length <= 1 ? current : { ...current, persons: current.persons.filter((person) => person.key !== key) },
      ),
    setPersonType: (key: string, type: ScPwdPersonType) =>
      change((current) => ({
        ...current,
        persons: current.persons.map((person) => (person.key === key ? { ...person, type } : person)),
      })),
    setPersonId: (key: string, idNo: string) =>
      change((current) => ({
        ...current,
        persons: current.persons.map((person) => (person.key === key ? { ...person, idNo } : person)),
      })),
    toggleLine: (lineKey: string) =>
      change((current) => ({
        ...current,
        markedKeys: current.markedKeys.includes(lineKey)
          ? current.markedKeys.filter((key) => key !== lineKey)
          : [...current.markedKeys, lineKey],
      })),
  };
}

export type ScPwdEditor = ReturnType<typeof useScPwdEditor>;
