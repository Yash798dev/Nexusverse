// src/app/services/history.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SubscriptionRecord {
  _id: string;
  planName: string;
  price: number;
  credits: number;
  subscribedAt: string;
}
export interface UserProfile {
  name: string;
  email: string;
  role: string;
  credits: number;
}
/** The settings a video was made with (see VideoJob.config on the server). */
export interface VideoJobConfig {
  durationSeconds?: number;
  tone?: string;
  voice?: string;
  language?: string;
  orientation?: 'portrait' | 'landscape';
  reviewScript?: boolean;
}

export interface VideoJobItem {
  _id?: string;
  prompt: string;
  createdAt?: string;
  completedAt?: string;
  status?: 'queued' | 'running' | 'failed' | 'completed' | 'uploaded';
  youtubeVideoId?: string;
  error?: string;

  // ── Added for the gallery: enough to actually SHOW the video ──
  /** Relative /uploads URL of the finished file, or null if there isn't one. */
  videoUrl?: string | null;
  /** Cached ffmpeg frame grab, or null when one could not be made. */
  thumbnailUrl?: string | null;
  youtubeUrl?: string | null;
  config?: VideoJobConfig;
  /** Documents this video was grounded in, if it came from the Knowledge Hub. */
  knowledgeTitles?: string[];
}

export interface VideoHistoryResponse {
  ok: boolean;
  page: number;
  limit: number;
  total: number;
  videos: VideoJobItem[];
}

@Injectable({ providedIn: 'root' })
export class HistoryService {
  base = `${environment.apiBase}/history`;

  constructor(private http: HttpClient) {}

  getSubscriptions(): Observable<{ ok: boolean; history: SubscriptionRecord[] }> {
    return this.http.get<{ ok: boolean; history: SubscriptionRecord[] }>(`${this.base}/subscriptions`);
  }

  

  getProfile(): Observable<UserProfile> {
    return this.http.get<UserProfile>(`${this.base}/profile`);
  }

  getMyVideos(page = 1, limit = 20): Observable<VideoHistoryResponse> {
    return this.http.get<VideoHistoryResponse>(`${this.base}/my?page=${page}&limit=${limit}`);
  }
}
