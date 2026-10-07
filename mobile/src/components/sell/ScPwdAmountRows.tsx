import { AmountRow } from '@/components/shared/AmountRow';
import { SC_PWD_DISCOUNT_LABEL } from '@/sale/scPwd';

type ScPwdAmountRowsProps = {
  /** The sale's `sc_pwd.vat_exempt`: the `VAT exempted` row shows only when it is ticked. */
  vatExempt: boolean;
  /** `R`: the VAT removed. */
  reliefCents: number;
  /** `S`: the SC/PWD discount. */
  discountCents: number;
  /** The rows' test ids start with this (`<prefix>-sc-pwd-vat`, `<prefix>-sc-pwd-discount`). */
  testIDPrefix: string;
  /** The rows' look (default `normal`; the cart and checkout breakdowns use `summary`). */
  variant?: 'normal' | 'summary';
};

/**
 * The SC/PWD rows of a totals block (Senior Citizen / PWD Discount → Device
 * rules → Display): `VAT exempted −31.61` (only when VAT exempt is ticked)
 * and `SC/PWD discount (20%) −52.68`. Used by the cart, checkout and the
 * order detail; the amounts come from the pricing or the server's `Order`.
 */
export function ScPwdAmountRows({ vatExempt, reliefCents, discountCents, testIDPrefix, variant = 'normal' }: ScPwdAmountRowsProps) {
  return (
    <>
      {vatExempt ? (
        <AmountRow label="VAT exempted" cents={reliefCents} deduction variant={variant} testID={`${testIDPrefix}-sc-pwd-vat`} />
      ) : null}
      <AmountRow
        label={SC_PWD_DISCOUNT_LABEL}
        cents={discountCents}
        deduction
        variant={variant}
        testID={`${testIDPrefix}-sc-pwd-discount`}
      />
    </>
  );
}
