export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #f4f4f1; color: #1a1a1a; }
    main { max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    h1 { font-size: 1.6rem; margin: 0 0 0.5rem; }
    p { line-height: 1.5; }
    a.button, button {
      display: inline-block; background: #ff6719; color: #fff; text-decoration: none;
      border: 0; border-radius: 6px; padding: 0.7rem 1rem; cursor: pointer; font: inherit;
    }
    a.button.secondary, button.secondary { background: #555; }
    input, textarea {
      font: inherit; padding: 0.6rem 0.75rem; border: 1px solid #ccc; border-radius: 6px;
      width: min(100%, 28rem); box-sizing: border-box;
    }
    textarea { min-height: 6rem; letter-spacing: 0; text-transform: none; }
    .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0; }
    .muted { color: #666; font-size: 0.95rem; }
    code { font-size: 0.9em; }
    .err { color: #8b0000; white-space: pre-wrap; }
    .ok { color: #0a7a32; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${body}
  </main>
</body>
</html>`;
}
