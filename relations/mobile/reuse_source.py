import json,hashlib
from pathlib import Path
p=Path('relations/release/latest.json');data=json.loads(p.read_text());source=Path('relations/release-existing/source-records.zip')
data['sourceArchive']['bytes']=source.stat().st_size;data['sourceArchive']['sha256']=hashlib.sha256(source.read_bytes()).hexdigest();p.write_text(json.dumps(data,indent=2)+'\n')
