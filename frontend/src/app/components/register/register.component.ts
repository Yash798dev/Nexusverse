
import { Component,OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FormsModule } from '@angular/forms';
import { ToastService } from '../../core/toast.service';
import { AgentBackdropComponent } from '../../shared/agent-backdrop/agent-backdrop.component';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';
import { SplitRevealDirective } from '../../shared/directives/split-reveal.directive';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, CommonModule, ReactiveFormsModule, RouterLink, AgentBackdropComponent, ThemeToggleComponent, SplitRevealDirective],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})

export class RegisterComponent implements OnInit{
  form = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    confirmPassword: ['', Validators.required]
  });
  loading = false;
  err: string | null = null;

  constructor(private fb: FormBuilder, private auth: AuthService, private router: Router, private toast: ToastService) {}
  ngOnInit(): void {
    // Add smooth entrance animation
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      document.body.style.overflow = 'auto';
    }, 600);
  }

  submit() {
    this.err = null;
    if (this.form.invalid) {
      this.err = 'Please complete the form correctly';
      return;
    }
    const v = this.form.value;
    if (v.password !== v.confirmPassword) {
      this.err = 'Passwords do not match';
      return;
    }
    this.loading = true;
    this.auth.register({ name: v.name, email: v.email, password: v.password, confirmPassword: v.confirmPassword })
      .subscribe({
        next: (res: any) => {
          this.loading = false;
          this.toast.success('Verification code sent', `Check ${v.email} for your code.`);
          this.router.navigate(['/verify-otp'], { queryParams: { email: v.email } });
        },
        error: (e) => {
          this.loading = false;
          this.err = e?.error?.error || e?.error?.message || 'Registration failed';
        }
      });
  }
  login(){
    this.router.navigate(['/login']);
  }
}
