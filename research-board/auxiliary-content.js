'use strict';

// These publisher components provide site navigation or promote an author's
// other work. Their links are independent of an article's narrative.
const UI_CLASSES = new Set(['multibranch-wrapper', 'rnb-navbar', 'earthworm']);

function isAuxiliaryClass(classes) {
  return classes.some(name => UI_CLASSES.has(name.toLowerCase()) || /^earthworm(?:__|--)/i.test(name));
}

function removeAuxiliaryContent(root) {
  for (const panel of root.querySelectorAll('.multibranch-wrapper, .rnb-navbar, .earthworm, [class*="earthworm__"]')) {
    panel.remove();
  }
  for (const panel of root.querySelectorAll('.collection')) {
    const headings = [panel, ...panel.querySelectorAll('.collapsible-block-link, summary, h1, h2, h3, h4, h5, h6')]
      .map(node => node.textContent.replace(/\s+/g, ' ').trim());
    // The table signature also identifies the component after the ordinary
    // credit/toggle cleanup has removed its "More From This Author" heading.
    if (headings.some(text => /\bmore (?:from|by) (?:this|the) author\b/i.test(text)) ||
        panel.querySelector('th.articlecolumn, td.articlecolumn')) {
      panel.remove();
    }
  }
}

module.exports = { removeAuxiliaryContent, isAuxiliaryClass };
