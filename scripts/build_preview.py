"""把 meme/ 下的模块打成一个可双击打开的 preview.html（不依赖 http 服务）。

用法：python scripts/build_preview.py
产物：preview.html（内联 CSS + 打包后的 JS，只外链 assets/ 里的壁纸）
"""

import base64
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULES = [
    "meme/data.js",
    "meme/store.js",
    "meme/host.js",
    "meme/icons.js",
    "meme/theme-data.js",
    "meme/shell.js",
    "meme/book.js",
    "meme/memory.js",
    "meme/apps/chat.js",
    "meme/apps/diary.js",
    "meme/apps/contacts.js",
    "meme/apps/settings.js",
    "meme/apps/more.js",
    "meme/apps/draw.js",
    "meme/apps/api.js",
    "meme/apps/user.js",
  "meme/apps/characters.js",
  "meme/apps/charphone.js",
  "meme/apps/music.js",
  "meme/apps/memory.js",
  "meme/apps/presets.js",
    "meme/reply-context.js",
    "meme/index.js",
]
ENTRY = "meme/index.js"

IMPORT_RE = re.compile(
    r"import\s+(?:\{([^}]*)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['\"]([^'\"]+)['\"]\s*;",
    re.S,
)
SIDE_IMPORT_RE = re.compile(r"import\s+['\"]([^'\"]+)['\"]\s*;")
EXPORT_DECL_RE = re.compile(r"^export\s+(const|let|var|function|async\s+function|class)\s+(\w+)", re.M)
EXPORT_BLOCK_RE = re.compile(r"^export\s*\{([^}]*)\}\s*;", re.M)


def resolve(from_id: str, spec: str) -> str:
    if spec.startswith("/"):
        return spec
    base = os.path.dirname(from_id)
    return os.path.normpath(os.path.join(base, spec)).replace("\\", "/")


def transform(module_id: str, source: str) -> str:
    exported = []

    def repl_import(match):
        names, star, default, spec = match.groups()
        target = resolve(module_id, spec)
        if target not in MODULES:
            raise SystemExit(f"{module_id} 引用了未打包的模块 {spec}")
        if names:
            names = re.sub(r"(\w+)\s+as\s+(\w+)", r"\1: \2", names)
            return f'const {{{names}}} = __req("{target}");'
        if star:
            return f'const {star} = __req("{target}");'
        return f'const {default} = __req("{target}").default;'

    body = IMPORT_RE.sub(repl_import, source)
    body = SIDE_IMPORT_RE.sub(lambda m: f'__req("{resolve(module_id, m.group(1))}");', body)

    def repl_block(match):
        for item in match.group(1).split(","):
            piece = item.strip()
            if not piece:
                continue
            alias = piece.split(" as ")[-1].strip()
            exported.append(alias)
        return ""

    body = EXPORT_BLOCK_RE.sub(repl_block, body)

    def repl_decl(match):
        kind, name = match.group(1), match.group(2)
        exported.append(name)
        return f"{kind} {name}"

    body = EXPORT_DECL_RE.sub(repl_decl, body)
    body = re.sub(r"^export\s+", "", body, flags=re.M)

    tail = "\n".join(f'exports["{name}"] = {name};' for name in exported)
    return f'__mods["{module_id}"] = function(module, exports, __req){{\n{body}\n{tail}\n}};'


def data_uri(rel_path: str) -> str:
    path = os.path.join(ROOT, rel_path.replace("/", os.sep))
    with open(path, "rb") as handle:
        payload = base64.b64encode(handle.read()).decode("ascii")
    ext = os.path.splitext(path)[1].lower()
    mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
    return f"data:{mime};base64,{payload}"


def build() -> str:
    parts = []
    for module_id in MODULES:
        path = os.path.join(ROOT, module_id.replace("/", os.sep))
        with open(path, "r", encoding="utf-8") as handle:
            parts.append(transform(module_id, handle.read()))

    runtime = f"""
(function(){{
  const __mods = {{}};
  const __cache = {{}};
  function __req(id){{
    if (__cache[id]) return __cache[id].exports;
    const module = {{ exports: {{}} }};
    __cache[id] = module;
    __mods[id](module, module.exports, __req);
    return module.exports;
  }}
{chr(10).join(parts)}
  const api = __req("{ENTRY}");
  const hash = (location.hash || '').replace(/^#/, '');
  const debug = location.search.indexOf('debug=1') >= 0 || hash.indexOf('debug=1') >= 0;
  const log = function(text){{
    if (!debug) return;
    let node = document.getElementById('mp-debug');
    if (!node) {{
      node = document.createElement('div');
      node.id = 'mp-debug';
      node.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9;font:11px/1.5 monospace;color:#3b3358;background:#fff9;padding:6px 8px;border-radius:8px;max-width:60vw;white-space:pre-wrap';
      document.body.append(node);
    }}
    node.textContent += text + '\\n';
  }};
  window.addEventListener('error', function(event){{ log('ERR: ' + event.message); }});
  log('boot, search=' + location.search);
  api.openMemePhone({{ demo: true }}).then(function(){{
    log('opened, phone=' + (document.getElementById('meme-phone') ? 'yes' : 'no'));
    const view = new URLSearchParams(location.search).get('view') || hash.split('&')[0];
    log('hash=' + hash + ' view=' + view);
    const rest = new URLSearchParams(hash.split('&').slice(1).join('&') || '');
    const params = {{}};
    rest.forEach(function(value, key) {{ if (key !== 'debug' && key !== 'night') params[key] = value; }});
    if (view) api.goView(view, params);
    if (hash.indexOf('night') >= 0) {{
      const node = document.getElementById('meme-phone');
      if (node) node.dataset.mpTheme = 'night';
    }}
    log('after goView, pages=' + document.querySelectorAll('.mp-page').length + ' desktop=' + document.querySelectorAll('.mp-desktop').length);
  }}).catch(function(error){{
    console.error('[meme] 预览启动失败', error);
    log('CATCH: ' + ((error && (error.stack || error.message)) || String(error)));
  }});
}})();
"""

    with open(os.path.join(ROOT, "meme", "meme.css"), "r", encoding="utf-8") as handle:
        css = handle.read().replace('url("../assets/', 'url("assets/')

    html = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>meme-phone · 界面预览</title>
<style>
html, body {{ height: 100%; margin: 0; }}
body {{
  display: grid;
  place-items: center;
  background:
    radial-gradient(90% 70% at 10% 6%, #ffe9f3 0%, transparent 58%),
    radial-gradient(80% 70% at 92% 92%, #e6faf2 0%, transparent 56%),
    linear-gradient(160deg, #fdf9ff, #f4f1fb 52%, #f7fbff);
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}}
{css}
</style>
</head>
<body>
<script>globalThis.__MEME_DEMO__ = true;</script>
<script>{runtime}</script>
</body>
</html>
"""
    out = os.path.join(ROOT, "preview.html")
    with open(out, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(html)
    return out


if __name__ == "__main__":
    target = build()
    print("built:", target, os.path.getsize(target), "bytes")
