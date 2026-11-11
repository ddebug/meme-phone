import io, os

CSS = """
/* ===== 本段：预设即 API（复制成新的一套） ===== */
.mp-api-clone {
  display: flex;
  width: 100%;
  margin-top: 10px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, .72);
  box-shadow: inset 0 0 0 1px var(--line);
  color: var(--text);
  font-size: 13px;
}

.mp-api-clone .mp-i { width: 16px; height: 16px; }

.mp-root[data-mp-theme="night"] .mp-api-clone {
  background: rgba(255, 255, 255, .06);
}

.mp-api-row .mp-api-tag {
  margin-left: 6px;
}
"""

path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'meme', 'meme.css')
with io.open(path, encoding='utf-8') as fh:
    text = fh.read()
if '.mp-api-clone' in text:
    print('already has .mp-api-clone, skip')
else:
    text = text.rstrip() + '\n' + CSS
    with io.open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)
    print('appended, bytes =', len(text.encode('utf-8')))
