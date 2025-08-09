export type Role = 'admin' | 'teacher' | 'student' | 'kiosk';

export interface Invite {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  token: string;        // random
  createdAt?: any;
  expiresAt?: any;      // optional
  used?: boolean;
}

export interface AppUser {
  id: string;            // equals uid after signup
  uid?: string;
  displayName: string;
  email: string;
  role: Role;
  createdAt?: any;
  updatedAt?: any;
}
