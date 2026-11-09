import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideClientHydration } from '@angular/platform-browser';
import { TokenHttpInterceptor } from './core/token-http-interceptor';
import { routes } from './app.routes';
import {  PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { AuthInterceptor } from './services/auth.interceptor';
export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(HttpClientModule),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions({
        skipInitialTransition: true,
        // Tag route transitions (as opposed to the theme reveal) so styles.css can
        // run the energy line that leads the page wipe.
        onViewTransitionCreated: ({ transition }) => {
          const root = document.documentElement;
          root.classList.add('ay-route-wiping');
          transition.finished.finally(() => root.classList.remove('ay-route-wiping'));
        },
      })
    ),
    provideHttpClient(withInterceptorsFromDi()),
    provideAnimations(),
    provideClientHydration(),
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    { provide: 'LOCAL_STORAGE', useFactory: getLocalStorage, deps: [PLATFORM_ID] }, provideAnimationsAsync()
  ]
};

// ✅ Safe `localStorage` handling function
export function getLocalStorage(platformId: Object): Storage | null {
  return isPlatformBrowser(platformId) ? localStorage : null;
}
