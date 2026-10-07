import { SwitchUserScreen } from '@/components/pin/SwitchUserScreen';

/** PIN quick-switch: GET /api/v1/auth/pin-users, then POST /api/v1/auth/pin. */
export default function SwitchUserRoute() {
  return <SwitchUserScreen />;
}
