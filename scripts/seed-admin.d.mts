export interface AdminRecord {
  id: string;
  email: string;
  displayName: string;
  role: string;
}
export interface AdminSeedClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: AdminRecord[] }>;
}
export function readAdminConfig(env: Record<string, string | undefined>): {
  email: string;
  displayName: string;
  password: string;
};
export function seedAdmin(
  client: AdminSeedClient,
  env: Record<string, string | undefined>,
): Promise<{
  status: 'created' | 'already-exists';
  admin: AdminRecord;
}>;
