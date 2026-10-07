import { router, type Href } from 'expo-router';

/** Goes back when there is history (the usual case), otherwise replaces with `fallback` (e.g. after a deep link). */
export function goBackOr(fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
