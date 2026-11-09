import { Injectable } from '@angular/core';
import { io, Socket } from "socket.io-client";
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SocketService {
  socket: Socket;
  constructor() {
    this.socket = io(environment.socketBase);
  }
  joinUserRoom(userId: string) {
    this.socket.emit('join', `user_${userId}`);
  }
  onProgress(cb: (data:any)=>void) {
    this.socket.on('video:progress', cb);
  }
  onVideoPath(cb: (data:any)=>void) {
    this.socket.on('video:video_path', cb);
  }
  onCompleted(cb: (data:any)=>void) {
    this.socket.on('video:completed', cb);
  }
  onUploaded(cb: (data:any)=>void) {
    this.socket.on('video:uploaded', cb);
  }
  onUploadFailed(cb: (data:any)=>void) {
    this.socket.on('video:upload_failed', cb);
  }
  offAll() {
    this.socket.off();
  }
}
