import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { Observable, tap } from 'rxjs';
import { StorageService } from '../core/storage.service';

export interface AuthUser {
  id: string;
  name?: string;
  email?: string;
  credits?: number;
}

export interface LoginResponse {
  ok: boolean;
  token: string;
  user: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  base = environment.apiBase;
  tokenKey = 'agt_jwt';
  private userIdKey = 'userId';
  private creditsKey = 'credits';
  private userKey = 'agt_user';

  constructor(private http: HttpClient, private router: Router, private storage: StorageService) {}

  register(payload: any) {
    return this.http.post(`${this.base}/auth/register`, payload);
  }

  verifyOtp(payload: any) {
    return this.http.post(`${this.base}/auth/verify-otp`, payload);
  }

  /**
   * Persists the session as a side effect so every caller gets the same state.
   * The login component used to do this itself with raw localStorage, which both
   * duplicated the token handling and skipped StorageService's browser guard.
   */
  login(payload: any): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.base}/auth/login`, payload)
      .pipe(tap((res) => this.saveSession(res)));
  }

  saveSession(res: LoginResponse) {
    if (!res?.token) return;
    this.saveToken(res.token);
    if (res.user) {
      this.storage.setItem(this.userKey, JSON.stringify(res.user));
      // Kept as separate keys because the socket rooms and credit badge read
      // them individually (server.js joins `user_<id>`).
      this.storage.setItem(this.userIdKey, String(res.user.id ?? ''));
      this.storage.setItem(this.creditsKey, String(res.user.credits ?? 0));
    }
  }

  saveToken(token: string) {
    this.storage.setItem(this.tokenKey, token);
  }

  getToken(): string | null {
    // Was raw localStorage.getItem() with no isPlatformBrowser guard — this app
    // has provideClientHydration() enabled, so any code path that reaches this
    // during SSR (a guard running on the server, an early ngOnInit) would throw
    // "localStorage is not defined". StorageService already handles that.
    return this.storage.getItem(this.tokenKey);
  }

  getUserId(): string | null {
    return this.storage.getItem(this.userIdKey);
  }

  getUser(): AuthUser | null {
    const raw = this.storage.getItem(this.userKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }

  /**
   * A token that is present but already expired is not a session — the guards
   * would wave the user through to a page whose every API call then 401s.
   */
  isLoggedIn(): boolean {
    const token = this.getToken();
    if (!token) return false;
    const exp = this.tokenExpiry(token);
    if (exp !== null && exp <= Date.now()) {
      this.clearSession();
      return false;
    }
    return true;
  }

  isAdmin(): boolean {
    return this.tokenPayload()?.role === 'admin';
  }

  private tokenPayload(): any | null {
    const token = this.getToken();
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
      return null;
    }
  }

  private tokenExpiry(token: string): number | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof payload?.exp === 'number' ? payload.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  clearSession() {
    this.storage.removeItem(this.tokenKey);
    this.storage.removeItem(this.userKey);
    this.storage.removeItem(this.userIdKey);
    this.storage.removeItem(this.creditsKey);
  }

  logout() {
    this.clearSession();
    this.router.navigate(['/login']);
  }

  getCredits(): Observable<{ credits: number }> {
    // Was a second hardcoded `http://localhost:8000/api/user` field that ignored
    // environment.apiBase, so pointing the app at a deployed API moved every
    // call except this one.
    return this.http.get<{ credits: number }>(`${this.base}/user/me/credits`);
  }
}
