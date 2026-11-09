// src/app/services/plan.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Plan {
  _id: string;
  name: string;
  description: string;
  price: number;
  credits: number;
  durationDays: number;
}

@Injectable({ providedIn: 'root' })
export class PlanService {
  base = `${environment.apiBase}/plans`;

  constructor(private http: HttpClient) {}

  getPlans(): Observable<{ ok: boolean; plans: Plan[] }> {
    return this.http.get<{ ok: boolean; plans: Plan[] }>(this.base);
  }

  subBase = `${environment.apiBase}/subscription`;

  subscribeToPlan(planId: string): Observable<any> {
    return this.http.post(`${this.subBase}/${planId}`, {});
  }
}
