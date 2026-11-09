import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * /admin had no route guard at all — any logged-in user (not just accounts
 * with role: "admin", per server/src/models/User.js) could open it client-side.
 * The backend's own admin routes/middleware are the real security boundary,
 * but the UI shouldn't invite non-admins in only to have every call 403.
 * The JWT already carries `role` (server/src/controllers/authcontroller.js),
 * so this decodes it locally rather than adding a round-trip just to gate a route.
 */
export const adminGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const token = auth.getToken();
  if (!token) {
    router.navigate(['/login'], { queryParams: { redirectTo: state.url } });
    return false;
  }

  if (auth.isAdmin()) {
    return true;
  }

  router.navigate(['/home']);
  return false;
};
