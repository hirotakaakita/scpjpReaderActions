'use strict';
// One-time immutable migration ledger from the published STG board
// revision 567e87a668607aa8babd, 2026-11-23.
// These aliases were assigned to English originals incorrectly because the
// topical 'pig' tag was mistaken for a Pig Latin origin tag.
// Preserve old *work* lookup keys without relabeling the underlying
// catalog itemId, whose value remains the same.
//
// Add new entries only with an independently proven previous-board owner,
// exact publisher URL, and an explicit versioned regression test.
const numbers=[
 '2430','2717','2727','2779','3127','3808','4381','4446',
 '4495','4511','4670','509','5694','5740','5994','6745',
 '7115','8069','8707','8876','9030','9308','9599'
];
const aliases=new Map(numbers.map(num=>[
 'https://scp-wiki.wikidot.com/scp-'+num,
 'catalog:scp-series-pig:scp-series-'+num
]));
aliases.set('https://scp-wiki.wikidot.com/scp-1551-ex','catalog:scp-pig-ex:scp-ex-1551');
module.exports={legacyEnglishTopicPigAliases:aliases};
