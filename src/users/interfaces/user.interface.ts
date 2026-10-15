import type { UserRole } from '../enums/user-role.enum.js';
import type { UserStatus } from '../enums/user-status.enum.js';

export interface User {
  id: string;
  displayName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
