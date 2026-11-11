import io, os

CSS = """
/* ===== 本段：换 API（点卡片就能切） ===== */
.mp-root .mp-api-card {
  position: relative;
  width: 100%;
  border: 0;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.mp-root .mp-api-card:active { transform: scale(.98); }

.mp-api-card-swap {
  position: absolute;
  right: 9px;
  top: 9px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: rgba(255, 255, 255, .7);
  color: var(--text-3);
}

.mp-api-card-swap .mp-i { width: 12px; height: 12px; }

.mp-root[data-mp-theme="night"] .mp-api-card-swap {
  background: rgba(255, 255, 255, .1);
}
"""

path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'meme', 'meme.css')
with io.open(path, encoding='utf-8') as fh:
    text = fh.read()
if '.mp-api-card-swap' in text:
    print('already has .mp-api-card-swap, skip')
else:
    text = text.rstrip() + '\n' + CSS
    with io.open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)
    print('appended, bytes =', len(text.encode('utf-8')))
