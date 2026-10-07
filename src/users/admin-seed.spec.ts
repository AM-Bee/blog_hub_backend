import * as bcrypt from 'bcrypt';
import { readAdminConfig, seedAdmin } from '../../scripts/seed-admin.mjs';

const env = {
  ADMIN_EMAIL: ' Admin@Example.com ',
  ADMIN_DISPLAY_NAME: ' Admin ',
  ADMIN_PASSWORD: 'password123',
};
const record = {
  id: 'admin-id',
  email: 'admin@example.com',
  displayName: 'Admin',
  role: 'admin',
};

describe('Admin seed', () => {
  it('validates and normalizes account fields without changing the password', () => {
    expect(readAdminConfig(env)).toEqual({
      email: 'admin@example.com',
      displayName: 'Admin',
      password: env.ADMIN_PASSWORD,
    });
  });

  it.each([
    { ...env, ADMIN_EMAIL: undefined },
    { ...env, ADMIN_EMAIL: 'invalid' },
    { ...env, ADMIN_DISPLAY_NAME: '   ' },
    { ...env, ADMIN_DISPLAY_NAME: 'a'.repeat(101) },
    { ...env, ADMIN_PASSWORD: undefined },
    { ...env, ADMIN_PASSWORD: 'short' },
    { ...env, ADMIN_PASSWORD: 'a'.repeat(73) },
    { ...env, ADMIN_PASSWORD: '😀'.repeat(19) },
  ])(
    'rejects invalid configuration before querying the database',
    async (config) => {
      const client = { query: vi.fn() };
      await expect(seedAdmin(client, config)).rejects.toThrow();
      expect(client.query).not.toHaveBeenCalled();
    },
  );

  it('creates an admin with a bcrypt hash and never returns the password', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [record] }),
    };
    const result = await seedAdmin(client, env);
    expect(result).toEqual({ status: 'created', admin: record });
    const [sql, values] = client.query.mock.calls[1];
    expect(sql).toContain("'admin'");
    expect(values[1]).toBe('admin@example.com');
    expect(values[2]).toBe('Admin');
    expect(await bcrypt.compare(env.ADMIN_PASSWORD, values[3])).toBe(true);
    expect(JSON.stringify(result)).not.toContain(env.ADMIN_PASSWORD);
    expect(result.admin).not.toHaveProperty('passwordHash');
  });

  it('does not change an existing admin or reset their password', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [record] }) };
    expect(await seedAdmin(client, env)).toEqual({
      status: 'already-exists',
      admin: record,
    });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('does not silently promote an existing author', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValue({ rows: [{ ...record, role: 'author' }] }),
    };
    await expect(seedAdmin(client, env)).rejects.toThrow(
      'belongs to an author',
    );
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('handles concurrent creation without overwriting credentials', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [record] }),
    };
    expect((await seedAdmin(client, env)).status).toBe('already-exists');
    expect(client.query.mock.calls[1][0]).toContain('DO NOTHING');
  });
});
