import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Was an empty file with zero routes wired to it — /admin, /profile,
 * /workflow, and /subscription all rendered for anyone regardless of login
 * state (API calls behind them would 401 via the auth interceptor, but the
 * page shell itself was reachable). This actually gates navigation.
 */
export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) {
    return true;
  }

  router.navigate(['/login'], { queryParams: { redirectTo: state.url } });
  return false;
};
