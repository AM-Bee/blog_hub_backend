import { BlogImageStore, MAX_BLOG_IMAGE_BYTES } from './blog-image.store.js';

const projectUrl = 'https://storage-test.supabase.co';
const secretKey = 'sb_secret_test_only';
const filename = '550e8400-e29b-41d4-a716-446655440000.png';
const objectUrl = `${projectUrl}/storage/v1/object/public/blog-images/${filename}`;
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function file(buffer = png, mimetype = 'image/png'): Express.Multer.File {
  return {
    buffer,
    mimetype,
    originalname: '../../unsafe.html',
  } as Express.Multer.File;
}

describe('Supabase blog image storage', () => {
  const store = new BlogImageStore();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', `${projectUrl}/`);
    vi.stubEnv('SUPABASE_SECRET_KEY', secretKey);
    vi.stubEnv('SUPABASE_STORAGE_BUCKET', 'blog-images');
    fetchMock = vi.fn().mockImplementation(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    ['image/png', png, 'png'],
    ['image/jpeg', Buffer.from([255, 216, 255, 224]), 'jpg'],
    ['image/webp', Buffer.from('RIFF0000WEBP'), 'webp'],
  ])(
    'uploads validated %s bytes and returns a public URL',
    async (mimetype, buffer, extension) => {
      const url = await store.save(file(buffer, mimetype));
      expect(url).toMatch(
        new RegExp(
          `^${projectUrl.replaceAll('.', '\\.')}\\/storage/v1/object/public/blog-images/[0-9a-f-]{36}\\.${extension}$`,
        ),
      );
      const uploadedName = url.slice(url.lastIndexOf('/') + 1);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `${projectUrl}/storage/v1/object/blog-images/${uploadedName}`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            apikey: secretKey,
            'Content-Type': mimetype,
            'x-upsert': 'false',
          },
          body: new Uint8Array(buffer),
          redirect: 'error',
          signal: expect.any(AbortSignal),
        }),
      );
      expect(url).not.toContain(secretKey);
      expect(url).not.toContain('unsafe');
    },
  );

  it.each([
    [file(Buffer.alloc(0)), 400],
    [file(Buffer.alloc(MAX_BLOG_IMAGE_BYTES + 1)), 413],
    [file(Buffer.from('not an image')), 400],
    [file(png, 'image/jpeg'), 400],
    [file(png, 'image/svg+xml'), 400],
  ])(
    'rejects invalid files before contacting storage',
    async (input, status) => {
      await expect(store.save(input)).rejects.toMatchObject({ status });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['SUPABASE_URL', 'SUPABASE_SECRET_KEY'])(
    'requires %s without falling back to local disk',
    async (key) => {
      vi.stubEnv(key, '');
      await expect(store.save(file())).rejects.toMatchObject({ status: 503 });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects unencrypted project URLs before sending the secret key', async () => {
    vi.stubEnv('SUPABASE_URL', 'http://storage-test.supabase.co');
    await expect(store.save(file())).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides storage error bodies and transport errors from callers', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(`Private provider response: ${secretKey}`, { status: 403 }),
    );
    await expect(store.save(file())).rejects.toMatchObject({
      status: 503,
      message: 'Image upload failed. Please try again.',
    });
    fetchMock.mockRejectedValueOnce(
      new Error(`Transport failed: ${secretKey}`),
    );
    await expect(store.save(file())).rejects.toMatchObject({
      status: 503,
      message: 'Image upload failed. Please try again.',
    });
  });

  it('removes its uploaded object when the repository requests rollback cleanup', async () => {
    await store.discard(objectUrl);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${projectUrl}/storage/v1/object/blog-images`,
      expect.objectContaining({
        method: 'DELETE',
        headers: { apikey: secretKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [filename] }),
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    `https://another.supabase.co/storage/v1/object/public/blog-images/${filename}`,
    `${projectUrl}/storage/v1/object/public/another-bucket/${filename}`,
    `${projectUrl}/storage/v1/object/public/blog-images/../${filename}`,
    `${objectUrl}?other=1`,
    `${projectUrl}/storage/v1/object/public/blog-images/%2e%2e/${filename}`,
    `/images/${filename}`,
  ])('never deletes foreign or arbitrary paths (%s)', async (url) => {
    await store.discard(url);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports failed cleanup instead of silently claiming the image was removed', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Unavailable', { status: 503 }),
    );
    await expect(store.discard(objectUrl)).rejects.toMatchObject({
      status: 503,
    });
  });
});
