import type { User } from '../../users/interfaces/user.interface.js';

export interface AdminUser extends User {
  blogCount: number;
}

export interface UserPage {
  items: User[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
