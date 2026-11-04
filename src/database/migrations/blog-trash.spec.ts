import type { QueryRunner } from 'typeorm';
import { AddBlogTrash1793836800000 } from './1793836800000-AddBlogTrash.js';

it('refuses to remove Trash fields while posts remain in Trash', async () => {
  const query = vi.fn(async (sql: string) =>
    sql.startsWith('SELECT') ? [{ occupied: true }] : [],
  );
  await expect(
    new AddBlogTrash1793836800000().down({ query } as unknown as QueryRunner),
  ).rejects.toThrow('Restore or permanently delete');
  expect(query.mock.calls[0][0]).toContain('ACCESS EXCLUSIVE');
  expect(
    query.mock.calls.some(
      ([sql]) => sql.startsWith('DROP') || sql.startsWith('ALTER'),
    ),
  ).toBe(false);
});
it('allows schema rollback only when Trash is empty', async () => {
  const query = vi.fn(async (sql: string) =>
    sql.startsWith('SELECT') ? [{ occupied: false }] : [],
  );
  await new AddBlogTrash1793836800000().down({
    query,
  } as unknown as QueryRunner);
  expect(query.mock.calls.at(-1)?.[0]).toContain('DROP COLUMN deleted_at');
});
