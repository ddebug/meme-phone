import io, os

CSS = """
/* ===== 本段：壁纸透进页面（不再是纯白玻璃） ===== */
.mp-root:not([data-mp-wall="none"]) .mp-page {
  background: linear-gradient(180deg, rgba(255, 252, 255, .52), rgba(248, 244, 254, .62));
}

.mp-root:not([data-mp-wall="none"]) .mp-thread {
  background: linear-gradient(180deg, rgba(255, 252, 255, .56), rgba(247, 243, 253, .66));
}

.mp-root:not([data-mp-wall="none"])[data-mp-theme="night"] .mp-page,
.mp-root:not([data-mp-wall="none"])[data-mp-theme="night"] .mp-thread {
  background: linear-gradient(180deg, rgba(24, 20, 38, .68), rgba(16, 13, 28, .78));
}

/* 页面里的白卡也跟着薄一点，别把壁纸整块盖死 */
.mp-root:not([data-mp-wall="none"]) .mp-row,
.mp-root:not([data-mp-wall="none"]) .mp-widget {
  background: rgba(255, 255, 255, .70);
}

.mp-root:not([data-mp-wall="none"])[data-mp-theme="night"] .mp-row,
.mp-root:not([data-mp-wall="none"])[data-mp-theme="night"] .mp-widget {
  background: rgba(38, 33, 58, .62);
}
"""

path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'meme', 'meme.css')
with io.open(path, encoding='utf-8') as fh:
    text = fh.read()
marker = '壁纸透进页面'
if marker in text:
    print('already applied, skip')
else:
    text = text.rstrip() + '\n' + CSS
    with io.open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)
    print('appended, bytes =', len(text.encode('utf-8')))
