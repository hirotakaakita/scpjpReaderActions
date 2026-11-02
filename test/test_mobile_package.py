import hashlib,importlib.util,json,tempfile,unittest,zipfile,gzip
from pathlib import Path
spec=importlib.util.spec_from_file_location('mobile_package',Path(__file__).resolve().parents[1]/'relations/mobile/package.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class MobilePackageTest(unittest.TestCase):
 def test_immutable_package_and_hash_validation(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);source=root/'data';records=root/'records';source.mkdir();records.mkdir()
   overview=gzip.compress(json.dumps({'revision':'a'*20,'generatedAt':'2026-11-03','pageCount':1,'edgeCount':0}).encode(),mtime=0)
   (source/'overview.json.gz').write_bytes(overview);(source/'manifest.json').write_text(json.dumps({'schemaVersion':1,'revision':'a'*20,'files':{'overview.json.gz':{'bytes':len(overview),'sha256':hashlib.sha256(overview).hexdigest()}}}))
   (records/('b'*64+'.json')).write_text('{}')
   first=module.package(source,records,root/'one','hirotakaakita/scpjpReaderActions');second=module.package(source,records,root/'two','hirotakaakita/scpjpReaderActions')
   self.assertEqual(first,second);self.assertEqual((root/'one/research-board-v1.zip').read_bytes(),(root/'two/research-board-v1.zip').read_bytes())
   with zipfile.ZipFile(root/'one/research-board-v1.zip') as z:self.assertTrue(all(i.compress_type==zipfile.ZIP_STORED for i in z.infolist()))
   (source/'overview.json.gz').write_bytes(b'corrupt')
   with self.assertRaises(AssertionError):module.package(source,records,root/'bad','hirotakaakita/scpjpReaderActions')
if __name__=='__main__':unittest.main()
