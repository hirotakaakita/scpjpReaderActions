"""Immutable mobile data + source observations, ready for GitHub Releases."""
import argparse, hashlib, json, re, zipfile, os
from pathlib import Path

def digest(data): return hashlib.sha256(data).hexdigest()
def file_digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()
FILE=re.compile(r'^(overview|tile_\d+_\d+|nodes_\d+|adj_\d+|evidence_\d+|search_[a-z-]+)\.json\.gz$')
def package(source, records, output, repo):
    source,records,output=map(Path,(source,records,output));output.mkdir(parents=True,exist_ok=True)
    raw=(source/'manifest.json').read_bytes();m=json.loads(raw);revision=m['revision']
    assert m['schemaVersion']==1 and re.fullmatch('[a-f0-9]{20}',revision)
    assert re.fullmatch('hirotakaakita/scpjpReaderActions(?:-stg)?',repo)
    tag='research-board-v1-'+revision;base=f'https://github.com/{repo}/releases/download/{tag}/'
    def put(z,name,data,compression):
        info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.external_attr=0o100644<<16;info.compress_type=compression
        z.writestr(info,data,compress_type=compression,compresslevel=6)
    archive=output/'research-board-v1.zip'
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_STORED) as z:
        put(z,'manifest.json',raw,zipfile.ZIP_STORED)
        for name,d in sorted(m['files'].items()):
            assert FILE.fullmatch(name),name
            data=(source/name).read_bytes();assert len(data)==d['bytes'] and digest(data)==d['sha256'],name
            put(z,name,data,zipfile.ZIP_STORED)
    assert archive.stat().st_size<=64*1024*1024
    source_zip=output/'source-records.zip'
    with zipfile.ZipFile(source_zip,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for name in sorted(n for n in os.listdir(records) if n.endswith('.json')):
            p=records/name
            assert re.fullmatch(r'[a-f0-9]{64}\.json',p.name),p.name
            put(z,p.name,p.read_bytes(),zipfile.ZIP_DEFLATED)
    import gzip
    overview=json.loads(gzip.decompress((source/'overview.json.gz').read_bytes()))
    def descriptor(p):return {'url':base+p.name,'bytes':p.stat().st_size,'sha256':file_digest(p)}
    pointer={'schemaVersion':1,'revision':revision,'generatedAt':overview['generatedAt'],
      'archive':descriptor(archive),'sourceArchive':descriptor(source_zip),
      'manifestSha256':digest(raw),'pageCount':overview['pageCount'],'edgeCount':overview['edgeCount']}
    (output/'latest.json').write_text(json.dumps(pointer,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'tag':tag,'mobileBytes':archive.stat().st_size,'sourceBytes':source_zip.stat().st_size}))
    return pointer
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--records',required=True);p.add_argument('--output',required=True);p.add_argument('--repo',required=True);a=p.parse_args();package(a.input,a.records,a.output,a.repo)
