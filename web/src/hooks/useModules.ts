import { MODULES, type AppModule } from '@/constants/modules';
import type { AuthUser } from '@/services/types';
import { useDineIn } from '@/hooks/useDiningTables';
import { useSessionStore } from '@/stores/session';
import { hasAnyPermission } from '@/utils/permissions';

/** Whether `user` may use `module` (any of its permissions; `null` = any signed-in user). A UI hint only. */
export function canUseModule(user: AuthUser | null, module: AppModule): boolean {
  if (!user) return false;
  return module.permissions === null || hasAnyPermission(user, module.permissions);
}

/** The modules the signed-in user may see, in sidebar order (a module that needs dine-in shows only while it is on). */
export function useVisibleModules(): AppModule[] {
  const user = useSessionStore((state) => state.user);
  const dineIn = useDineIn().enabled;
  return MODULES.filter((module) => canUseModule(user, module) && (module.requires !== 'dine_in' || dineIn));
}

/** The first ready module the user may open (the landing page after login). */
export function firstReadyModule(user: AuthUser | null): AppModule | null {
  return MODULES.find((module) => module.ready && canUseModule(user, module)) ?? null;
}
