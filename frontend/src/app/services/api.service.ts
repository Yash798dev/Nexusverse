import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  base = environment.apiBase;
  constructor(private http: HttpClient, private auth: AuthService) {}

  post(path: string, body: any) {
  return this.http.post(`${this.base}${path}`, body);
}
get(path: string) {
  return this.http.get(`${this.base}${path}`);
}

}
