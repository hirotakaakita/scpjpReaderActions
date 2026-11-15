'use strict';
// Preserve the logical Wikidot namespace in JSON while keeping filenames portable.
function partialFileName(language,page){return `${language}--${encodeURIComponent(page)}.json`;}
module.exports={partialFileName};
