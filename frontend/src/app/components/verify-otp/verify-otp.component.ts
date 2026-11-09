


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
  selector: 'app-verify-otp',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, AgentBackdropComponent, ThemeToggleComponent, SplitRevealDirective],
  templateUrl: './verify-otp.component.html',
  styleUrl: './verify-otp.component.css'
})

export class VerifyOtpComponent implements OnInit {
  email: string | null = null;
  form = this.fb.group({ otp: ['', Validators.required] });
  loading = false;
  verified = false;
  err: string | null = null;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private auth: AuthService,
    private router: Router,
    private toast: ToastService
  ) {}

  ngOnInit() {
    this.route.queryParams.subscribe(p => this.email = p['email'] || null);
  }

  submit() {
    if (!this.email) { this.err = "Missing email"; return; }
    if (this.form.invalid) { this.err = "Enter OTP"; return; }
    this.loading = true;
    this.auth.verifyOtp({ email: this.email, otp: this.form.value.otp }).subscribe({
      next: () => {
        this.loading = false;
        this.verified = true;
        this.toast.success('Email verified', 'Sign in to open your studio.');
        // Hand the address to the login screen so the user doesn't retype it.
        this.router.navigate(['/login'], { queryParams: { email: this.email } });
      },
      error: (e) => {
        this.loading = false;
        this.err = e?.error?.error || 'Verification failed';
      }
    });
  }
}
