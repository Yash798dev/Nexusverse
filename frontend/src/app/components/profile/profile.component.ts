import { Component, OnInit } from '@angular/core';
import { HistoryService, SubscriptionRecord,UserProfile, VideoJobItem } from '../../services/history.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import { AgentBackdropComponent } from '../../shared/agent-backdrop/agent-backdrop.component';
import { AgentLoaderComponent } from '../../shared/agent-loader/agent-loader.component';
import { RevealDirective } from '../../shared/directives/reveal.directive';
import { AppNavComponent } from '../../shared/app-nav/app-nav.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, AgentBackdropComponent, AgentLoaderComponent, RevealDirective, AppNavComponent],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.css'
})
export class ProfileComponent implements OnInit {
  subscriptions: SubscriptionRecord[] = [];
  user: UserProfile | null = null;
  loading = false;
  error: string | null = null;
   videos: VideoJobItem[] = [];
  page = 1;
  limit = 20;
  total = 0;

  /** Gallery search — filters the videos on the current page by prompt text. */
  query = '';

  constructor(private historyService: HistoryService,private userService:AuthService,private router:Router) {}

  ngOnInit(): void {
    this.loadHistory();
    this.fetch();

    this.historyService.getProfile().subscribe({
      next: (data) => {
        this.user = data;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.error || "Failed to load profile";
        this.loading = false;
      }
    });

    this.userService.getCredits().subscribe({
      next: (res) => {
        this.credits = res.credits;
      },
      error: (err) => {
        console.error('Failed to load credits', err);
      }
    });
  }


  loadHistory() {
    this.loading = true;
    this.historyService.getSubscriptions().subscribe({
      next: (res) => {this.subscriptions = res.history;

      },
      error: () => (this.error = 'Failed to load subscriptions')
    });

  }

  fetch(page = 1) {
    this.loading = true;
    this.error = null;
    this.historyService.getMyVideos(page, this.limit).subscribe({
      next: (res) => {
        this.videos = res.videos || [];
        this.page = res.page || 1;
        this.limit = res.limit || this.limit;
        this.total = res.total || 0;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load videos';
        this.loading = false;
      }
    });
  }

  get filteredVideos(): VideoJobItem[] {
    const q = this.query.trim().toLowerCase();
    return q ? this.videos.filter((v) => (v.prompt || '').toLowerCase().includes(q)) : this.videos;
  }

  /** Position of a video across all pages (newest first). */
  videoNumber(v: VideoJobItem): number {
    return (this.page - 1) * this.limit + this.videos.indexOf(v) + 1;
  }

  trackVideo(index: number, v: VideoJobItem): string | number {
    return v._id ?? index;
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
