/**
 * Login (Auth §login): email + password only. A 401 ("Invalid email or
 * password."), 403 (deactivated) or 429 shows in the banner; 422 messages sit
 * under their fields. On success the session starts and the terminal registers.
 *
 * Layout: on wide screens (≥ lg) a deep-green panel with what the system does
 * sits beside the form; below that, only the form card over the emerald band.
 * The panel uses `green-hover` (white text ≈ 7:1) and keeps the band gradient
 * decorative only, because white text on its light end would fail contrast.
 */
import {
  BarChart3Icon,
  BoxesIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderCircleIcon,
  LockKeyholeIcon,
  ReceiptTextIcon,
  ShoppingCartIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FormField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { APP_VERSION, useLogin } from '@/hooks/useAuth';
import { firstReadyModule } from '@/hooks/useModules';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import { useSessionStore } from '@/stores/session';

const FEATURES: readonly { icon: LucideIcon; title: string; text: string }[] = [
  { icon: ShoppingCartIcon, title: 'Sell fast', text: 'Ring up orders, discounts and split payments in a few taps.' },
  { icon: BoxesIcon, title: 'Stock that keeps up', text: 'Every sale, receipt and recipe updates inventory on its own.' },
  { icon: ReceiptTextIcon, title: 'Close the day clean', text: 'Cash counts, X-reads and Z-reads with the variance worked out.' },
  { icon: BarChart3Icon, title: 'Know your numbers', text: 'Live dashboard and reports you can export to CSV.' },
];

export function LoginPage() {
  const status = useSessionStore((state) => state.status);
  const notice = useSessionStore((state) => state.notice);
  const user = useSessionStore((state) => state.user);
  const location = useLocation();
  const navigate = useNavigate();
  const loginMutation = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [localErrors, setLocalErrors] = useState<{ email?: string; password?: string }>({});

  if (status === 'signedIn' && !loginMutation.isPending) {
    const from = (location.state as { from?: string } | null)?.from;
    const home = firstReadyModule(user);
    return <Navigate to={from && from !== '/login' ? from : (home?.path ?? '/')} replace />;
  }

  const serverErrors = isApiValidationError(loginMutation.error) ? loginMutation.error : null;
  const bannerError = loginMutation.error && !serverErrors ? getErrorMessage(loginMutation.error) : null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const errors: { email?: string; password?: string } = {};
    if (email.trim() === '') errors.email = 'Enter your email.';
    if (password === '') errors.password = 'Enter your password.';
    setLocalErrors(errors);
    if (errors.email || errors.password) return;
    useSessionStore.getState().clearNotice();
    loginMutation.mutate(
      { email: email.trim(), password },
      {
        onSuccess: (response) => {
          const home = firstReadyModule(response.user);
          void navigate(home?.path ?? '/', { replace: true });
        },
      },
    );
  }

  return (
    <main className="grid min-h-dvh bg-muted lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <FeaturePanel />

      <section className="relative flex items-center justify-center p-4 sm:p-8">
        {/* Below lg the panel is hidden; the band keeps the page from feeling bare. */}
        <div aria-hidden="true" className="pos-band pointer-events-none fixed inset-x-0 top-0 h-[240px] lg:hidden" />

        <Card className="relative w-full max-w-md p-6 shadow-lg sm:p-8">
          <div className="mb-6 flex flex-col gap-3">
            <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-xl bg-green-soft text-green">
              <LockKeyholeIcon className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
              <p className="text-sm text-muted-foreground">Sign in with your staff email and password.</p>
            </div>
          </div>

          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={loginMutation.isPending}>
            <ErrorSummary />
            {notice ? <Banner variant="info">{notice}</Banner> : null}
            {bannerError ? <Banner>{bannerError}</Banner> : null}

            <FormField label="Email" error={localErrors.email ?? serverErrors?.firstError('email')}>
              <Input
                type="email"
                inputMode="email"
                autoComplete="username"
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={loginMutation.isPending}
                className="h-11"
              />
            </FormField>

            <FormField
              label="Password"
              error={localErrors.password ?? serverErrors?.firstError('password')}
              hint={
                capsLock ? (
                  <span className="inline-flex items-center gap-1.5 text-warning">
                    <TriangleAlertIcon className="size-3.5" aria-hidden="true" />
                    Caps Lock is on.
                  </span>
                ) : undefined
              }
            >
              <PasswordInput
                value={password}
                onChange={setPassword}
                show={showPassword}
                onToggle={() => setShowPassword((value) => !value)}
                onCapsLock={setCapsLock}
                disabled={loginMutation.isPending}
              />
            </FormField>

            <Button type="submit" variant="green" size="xl" className="mt-2 w-full" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
              {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 border-t pt-4 text-center text-xs text-muted-foreground">
            Forgot your password? Ask a manager to reset it.
          </p>
        </Card>
      </section>
    </main>
  );
}

/** The wide-screen panel: what the system does, on deep green. Decorative shapes are hidden from assistive tech. */
function FeaturePanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-green-hover text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
      <div aria-hidden="true" className="pos-band pointer-events-none absolute -top-40 -right-40 size-[480px] rounded-full opacity-40 blur-3xl" />
      <div aria-hidden="true" className="pos-band pointer-events-none absolute -bottom-48 -left-32 size-[420px] rounded-full opacity-25 blur-3xl" />

      <div className="relative">
        <p className="text-sm font-semibold tracking-widest text-white/80 uppercase">Point of sale</p>
        <h2 className="mt-4 max-w-md text-4xl leading-tight font-bold xl:text-5xl">Every sale, every shift, in one place.</h2>
        <p className="mt-4 max-w-md text-base text-white/85">The cashier terminal and the back-office share one system, so the counter and the office always see the same numbers.</p>
      </div>

      <ul className="relative mt-10 grid max-w-xl grid-cols-2 gap-x-8 gap-y-6">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex flex-col gap-2">
            <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
              <Icon className="size-5" />
            </span>
            <p className="font-semibold">{title}</p>
            <p className="text-sm text-white/80">{text}</p>
          </li>
        ))}
      </ul>

      <p className="relative mt-10 text-xs text-white/70">Version {APP_VERSION}</p>
    </aside>
  );
}

type PasswordInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
  onCapsLock: (on: boolean) => void;
  disabled: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

function PasswordInput({ value, onChange, show, onToggle, onCapsLock, disabled, ...aria }: PasswordInputProps) {
  function readCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    onCapsLock(event.getModifierState('CapsLock'));
  }

  return (
    <div className="relative">
      <Input
        {...aria}
        type={show ? 'text' : 'password'}
        autoComplete="current-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={readCapsLock}
        onKeyUp={readCapsLock}
        onBlur={() => onCapsLock(false)}
        disabled={disabled}
        className="h-11 pr-12"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-1 right-1"
        onClick={onToggle}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
      >
        {show ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
      </Button>
    </div>
  );
}
