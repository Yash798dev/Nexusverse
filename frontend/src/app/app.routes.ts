import { Routes } from '@angular/router';
import { authGuard } from './core/auth-guard';
import { adminGuard } from './core/admin-guard';

// Lazy-loaded (loadComponent) rather than eager component: imports — the
// previous all-eager setup meant every route's code (including the Three.js
// landing-page hero, ~1.1MB) shipped in the single initial main.js bundle
// regardless of which page a visitor actually landed on. Splitting per-route
// means /login doesn't pay for the landing page's 3D scene, etc.
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/landingpage/landingpage.component').then((m) => m.LandingpageComponent),
  },
  {
    path: 'home',
    loadComponent: () => import('./components/home/home.component').then((m) => m.HomeComponent),
    canActivate: [authGuard],
  },
  {
    path: 'login',
    loadComponent: () => import('./components/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./components/register/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'verify-otp',
    loadComponent: () =>
      import('./components/verify-otp/verify-otp.component').then((m) => m.VerifyOtpComponent),
  },
  {
    path: 'workflow',
    loadComponent: () =>
      import('./components/workflow/workflow.component').then((m) => m.WorkflowComponent),
    canActivate: [authGuard],
  },
  {
    path: 'knowledge',
    loadComponent: () =>
      import('./modules/knowledge/knowledge-library.component').then((m) => m.KnowledgeLibraryComponent),
    canActivate: [authGuard],
  },
  {
    path: 'knowledge/:id',
    loadComponent: () =>
      import('./modules/knowledge/knowledge-detail.component').then((m) => m.KnowledgeDetailComponent),
    canActivate: [authGuard],
  },
  {
    path: 'videos',
    loadComponent: () =>
      import('./modules/studio/video-gallery.component').then((m) => m.VideoGalleryComponent),
    canActivate: [authGuard],
  },
  {
    path: 'subscription',
    loadComponent: () =>
      import('./components/subscription/subscription.component').then((m) => m.SubscriptionComponent),
    canActivate: [authGuard],
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('./components/profile/profile.component').then((m) => m.ProfileComponent),
    canActivate: [authGuard],
  },
  {
    path: 'admin',
    loadComponent: () => import('./components/admin/admin.component').then((m) => m.AdminComponent),
    canActivate: [authGuard, adminGuard],
  },
];
