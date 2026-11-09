import { Component, OnInit } from '@angular/core';
import { PlanService, Plan } from '../../services/plan.service';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../core/toast.service';
import { AgentBackdropComponent } from '../../shared/agent-backdrop/agent-backdrop.component';
import { AgentLoaderComponent } from '../../shared/agent-loader/agent-loader.component';
import { RevealDirective } from '../../shared/directives/reveal.directive';
import { AppNavComponent } from '../../shared/app-nav/app-nav.component';

@Component({
  selector: 'app-subscription',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, AgentBackdropComponent, AgentLoaderComponent, RevealDirective, AppNavComponent],
  templateUrl: './subscription.component.html',
  styleUrls: ['./subscription.component.css']
})
export class SubscriptionComponent {
  plans: Plan[] = [];
  loading = false;
  error: string | null = null;
  success: string | null = null;

  constructor(
    private planService: PlanService,
    private router:Router,
    private userService:AuthService,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.fetchPlans();

    this.userService.getCredits().subscribe({
      next: (res) => {
        this.credits = res.credits;
      },
      error: (err) => {
        console.error('Failed to load credits', err);
      }
    });
  }

  fetchPlans() {
    this.loading = true;
    this.planService.getPlans().subscribe({
      next: (res) => {
        this.plans = res.plans;
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to fetch plans';
        this.loading = false;
      }
    });
  }

  choosePlan(plan: Plan) {
    this.success = null;
    this.error = null;

    this.planService.subscribeToPlan(plan._id).subscribe({
      next: (res) => {
        this.success = `Successfully subscribed to ${plan.name}. Credits: ${res.credits}`;
        this.toast.success(`Subscribed to ${plan.name}`, `You now have ${res.credits} credits.`);
        this.router.navigate(['/home']);

      },
      error: () => {
        this.error = 'Subscription failed';
        this.toast.error('Subscription failed', 'Nothing was charged. Please try again.');
      }
    });
  }


  isScrolled = false;
  credits:number|null=null;

  onWorkflow(): void {
    console.log('Navigate to Workflows');
    this.router.navigate(['/workflow']);
  }

  home(): void {
    this.router.navigate(['/home']);
  }

  onLogout(): void {
    this.userService.logout();
  }
  pricing(){
    this.router.navigate(['/subscription']);
  }




}
