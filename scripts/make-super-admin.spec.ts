import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
// Load the actual CLI function without running its entry point.
const script = pathToFileURL(
  createRequire(import.meta.url).resolve('./make-super-admin.mjs'),
).href;
const { makeSuperAdmin } = await import(/* @vite-ignore */ script);

describe('Main admin bootstrap safeguards', () => {
  const id = randomUUID();
  function client(existing: string[] = [], rowCount = 1) {
    return {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id'))
          return { rows: existing.map((id) => ({ id })) };
        return { rowCount };
      }),
    };
  }
  it('validates before touching the database', async () => {
    const db = client();
    await expect(makeSuperAdmin(db, 'invalid')).rejects.toThrow('UUID');
    expect(db.query).not.toHaveBeenCalled();
  });
  it('locks and commits a selected admin, including an idempotent rerun', async () => {
    for (const existing of [[], [id]]) {
      const db = client(existing);
      await expect(makeSuperAdmin(db, id)).resolves.toEqual({
        id,
        role: 'super_admin',
      });
      expect(db.query.mock.calls[0][0]).toBe('BEGIN');
      expect(db.query.mock.calls[1][0]).toContain('pg_advisory_xact_lock');
      expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    }
  });
  it('rolls back if another main admin exists without changing users', async () => {
    const db = client([randomUUID()]);
    await expect(makeSuperAdmin(db, id)).rejects.toThrow(
      'different main admin',
    );
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(
      false,
    );
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('rolls back for a missing, disabled, or author target', async () => {
    const db = client([], 0);
    await expect(makeSuperAdmin(db, id)).rejects.toThrow('active admin');
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
});
