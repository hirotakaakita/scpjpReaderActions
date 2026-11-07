'use strict';
const fs=require('node:fs'),path=require('node:path');
const {LANGUAGES}=require('./languages');
const {normalize}=require('./related-documents');
const {readState,isExcluded}=require('./catalog-indexes');
function validate(root=__dirname){
  const definition=JSON.parse(fs.readFileSync(path.join(root,'catalog-index-sources.json'))),seen=new Set();
  const kinds=new Set(['scp','tale','goi-format','canon','record','setting','international-hub']);
  for(const s of definition.sources){
    if(!LANGUAGES[s.language]||!kinds.has(s.kind)||s.language==='id')throw Error('Invalid index source');
    const u=new URL(s.url);
    if(u.protocol!=='https:'||u.hostname!==new URL(LANGUAGES[s.language].baseUrl).hostname||u.username||u.password||u.port||u.search||u.hash)throw Error('Unsafe index URL');
    if(seen.has(s.url)||isExcluded(s.url)||/(?:^|-)id(?:-|$)/i.test(u.pathname.slice(1)))throw Error('Duplicate or excluded index');
    seen.add(s.url);
  }
  const states=[];
  for(const language of Object.keys(LANGUAGES)){
    const file=path.join(root,'local-data/catalog-indexes',language+'.json.gz');
    if(!fs.existsSync(file))continue;
    const state=readState(file);if(state.language!==language)throw Error('Wrong state language');
    for(const index of Object.values(state.indexes))for(const m of index.members){
      if(normalize(m.url)?.language!==language||!m.source)throw Error('Invalid indexed member');
    }
    states.push({language,...state.statistics});
  }
  const output={sources:seen.size,states};console.log(JSON.stringify(output));return output;
}
if(require.main===module)validate();
module.exports={validate};
