import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../core/toast.service';
import { AgentBackdropComponent } from '../../shared/agent-backdrop/agent-backdrop.component';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';
import { SplitRevealDirective } from '../../shared/directives/split-reveal.directive';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, RouterLink, AgentBackdropComponent, ThemeToggleComponent, SplitRevealDirective],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent implements OnInit {
  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });
  loading = false;
  err: string | null = null;

  /** Where authGuard wanted the user to land before it bounced them here. */
  private redirectTo = '/home';

  /** Set when the backend rejects the login with "email not verified". */
  needsVerification = false;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.redirectTo = this.route.snapshot.queryParamMap.get('redirectTo') || '/home';

    // Arriving from /verify-otp (or a "verify now" bounce) carries the address.
    const email = this.route.snapshot.queryParamMap.get('email');
    if (email) {
      this.form.patchValue({ email });
    }

    // Already signed in — no reason to show the form again.
    if (this.auth.isLoggedIn()) {
      this.router.navigateByUrl(this.redirectTo);
    }
  }

  submit() {
    this.err = null;
    this.needsVerification = false;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.err = 'Enter a valid email and your password';
      return;
    }

    this.loading = true;
    this.auth.login(this.form.value).subscribe({
      next: () => {
        // AuthService.saveSession() already stored the token, user id and credits.
        this.loading = false;
        this.toast.success('Signed in', 'Welcome back to your studio.');
        this.router.navigateByUrl(this.redirectTo);
      },
      error: (e) => {
        this.loading = false;
        this.err = e?.error?.error || e?.error?.message || 'Login failed';
        // The backend answers 403 for an account that never completed OTP —
        // offer the verify screen instead of leaving the user stuck on an error.
        this.needsVerification = e?.status === 403;
      },
    });
  }

  verifyNow() {
    this.router.navigate(['/verify-otp'], {
      queryParams: { email: this.form.value.email },
    });
  }

  register() {
    this.router.navigate(['/register']);
  }
}
