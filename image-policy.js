'use strict';
function decorativeImageReason(value) {
 if(!value)return null;
 let src=String(value).toLowerCase();
 try{src=decodeURIComponent(src);}catch{}
 if(/\{\$/.test(src))return 'unexpanded_template';
 if(/\/(?:nav|component):|\/(?:nav|side|avatars?)\/|\/avatar(?:\.php)?(?:[?\/]|$)|\/_template\/|\/files\/util\/|\/common\/media\/|heritage-rating|scp-heritage/.test(src))return 'interface_asset';
 if(/\/module-de-credit\//.test(src))return 'credit_asset';
 if(/(?:^|\/)(?:blank|transparent|spacer|clear|pixel|1x1)\.(?:png|gif)(?:[?#]|$)/.test(src))return 'transparent_pixel';
 if(/(?:^|\/)aw-signature\.png(?:[?#]|$)/.test(src))return 'author_signature';
 return null;
}
function cleanImage(value){return !value||decorativeImageReason(value)?null:value;}
module.exports={decorativeImageReason,cleanImage};
