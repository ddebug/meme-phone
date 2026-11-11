import io, os, glob

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = glob.glob(os.path.join(root, 'meme', '**', '*.js'), recursive=True)

changed = []
for path in files:
    with io.open(path, encoding='utf-8') as fh:
        old = fh.read()
    if 'ctx.shell.rerender(' in old:
        new = old.replace('ctx.shell.rerender(', 'ctx.rerender(')
        with io.open(path, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(new)
        changed.append(os.path.relpath(path, root))

print('rerender fixed:', changed)
