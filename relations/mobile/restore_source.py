"""Restore release-backed observations if the 90-day Actions artifact expired."""
import argparse, hashlib, json, re, tempfile, urllib.request, zipfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--pointer',required=True);p.add_argument('--repo',required=True);p.add_argument('--output',required=True);a=p.parse_args()
config=json.loads(Path(a.pointer).read_text());d=config['sourceArchive'];url=d['url']
assert url.startswith(f'https://github.com/{a.repo}/releases/download/research-board-v1-') and url.endswith('/source-records.zip')
assert 0<d['bytes']<=512*1024*1024 and re.fullmatch('[a-f0-9]{64}',d['sha256'])
out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryFile() as f:
    h=hashlib.sha256();size=0
    with urllib.request.urlopen(url,timeout=60) as r:
        while chunk:=r.read(1024*1024):
            size+=len(chunk);assert size<=d['bytes'];h.update(chunk);f.write(chunk)
    assert size==d['bytes'] and h.hexdigest()==d['sha256'];f.seek(0)
    with zipfile.ZipFile(f) as z:
        assert len(z.infolist())<300000
        for info in z.infolist():
            assert re.fullmatch('[a-f0-9]{64}\.json',info.filename) and info.file_size<16*1024*1024
            data=z.read(info);json.loads(data);(out/info.filename).write_bytes(data)
print('Restored source observations from verified release')
