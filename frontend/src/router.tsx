import { Operator } from './researcher/Operations';
import { AssignedTerminal } from './assessor/Assessor';
import { PairTablet } from './assessor/Pair';
import { Foundation } from './researcher/Foundation';
import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes } from 'react';
import { Gallery } from './dev/Gallery';

const routeEvent = 'sensibilia:navigate';
const historyKey = 'sensibiliaIndex';
let historyIndex: number = window.history.state?.[historyKey] ?? 0;
let currentHref = window.location.pathname + window.location.search;
let restoringHistory = false;
let subscriberCount = 0;
window.history.replaceState(
  { ...window.history.state, [historyKey]: historyIndex },
  '',
  window.location.href,
);

let navigationGuard: ((href: string) => boolean) | undefined;
export function setNavigationGuard(guard: typeof navigationGuard) {
  navigationGuard = guard;
}

export function navigate(href: string, replace = false) {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return;
  if (navigationGuard && !navigationGuard(url.pathname + url.search)) return;
  if (!replace) historyIndex += 1;
  currentHref = url.pathname + url.search;
  window.history[replace ? 'replaceState' : 'pushState']({ [historyKey]: historyIndex }, '', url);
  window.dispatchEvent(new Event(routeEvent));
}

function onHistoryNavigation() {
  if (restoringHistory) {
    restoringHistory = false;
    return;
  }
  const nextHref = window.location.pathname + window.location.search;
  const nextIndex: number = window.history.state?.[historyKey] ?? historyIndex;
  if (navigationGuard && !navigationGuard(nextHref)) {
    const distance = historyIndex - nextIndex;
    if (distance) {
      restoringHistory = true;
      window.history.go(distance);
    } else window.history.replaceState({ [historyKey]: historyIndex }, '', currentHref);
    return;
  }
  historyIndex = nextIndex;
  currentHref = nextHref;
  window.dispatchEvent(new Event(routeEvent));
}
function subscribe(listener: () => void) {
  if (subscriberCount++ === 0) window.addEventListener('popstate', onHistoryNavigation);
  window.addEventListener(routeEvent, listener);
  return () => {
    if (--subscriberCount === 0) window.removeEventListener('popstate', onHistoryNavigation);
    window.removeEventListener(routeEvent, listener);
  };
}

export function useRoute() {
  return useSyncExternalStore(subscribe, () => window.location.pathname + window.location.search);
}

export function Link({ href = '/', onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.download !== undefined ||
          (props.target && props.target !== '_self') ||
          new URL(href, window.location.href).origin !== window.location.origin
        )
          return;
        event.preventDefault();
        navigate(href);
      }}
    />
  );
}

const routes = {
  '/': { redirect: '/dev/ui' },
  '/dev/ui': { component: Gallery },
} as const;

export function Router() {
  // Query strings (such as the pairing QR's ?ca=) never select a screen.
  const pathname = useRoute().split('?')[0];
  const route = routes[pathname as keyof typeof routes];
  useEffect(() => {
    if (route && 'redirect' in route) navigate(route.redirect, true);
  }, [route]);
  const assessor = /^\/assessor\/sessions\/([a-f0-9-]{36})$/.exec(pathname);
  if (pathname === '/assessor/' || pathname === '/assessor') return <AssignedTerminal />;
  if (pathname === '/assessor/pair') return <PairTablet />;
  if (assessor) return <AssignedTerminal key={assessor[1]} requestedId={assessor[1]} />;
  if (pathname === '/operator' || pathname === '/operator/') return <Operator />;
  if (pathname.startsWith('/researcher')) return <Foundation />;
  if (!route) return <p>Not found.</p>;
  if ('redirect' in route) return null;
  const Component = route.component;
  return <Component />;
}
