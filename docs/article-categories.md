# Official-index article categories

`pageType` continues to describe the original branch and SCP family. It remains
`related-document-<branch>` for non-SCP works, preserving the article identity contract.
`contentType` describes the article's category:

| Value | Category |
|---|---|
| scp | SCP (normal, EX and Joke retain their existing pageType) |
| tale | Tales and narrative series |
| goi | GoI formats |
| record | Records and supplements |
| setting | World and setting |
| hub | Canon and work hubs |
| other | Other / pending classification |

The classifier uses explicit article tags before falling back to official-index
listing kinds. Canon membership alone does not make an article a hub. Without
sufficient evidence it uses `other`; it does not infer a category from a title.
The source index URLs, tags and index evidence remain available for correction.
Article types do not determine original branches or change published item IDs.

Weekly collection and merging reapply the classifier to both fetched and retained
articles. The app groups HOME by category and original branch and filters search
by category. Legacy `log` maps to `record`; `document` and unknown non-SCP values
map to `other`. The expanded official-index catalog is delivered through mobile-v3 to app 1.7.1.
mobile-v2 uses the frozen related-documents-v2 snapshot plus weekly ordinary
catalog updates, so app 1.7.0 does not receive the expanded scope. mobile-v1
continues to contain the ordinary catalog only.

The initial official-index crawl is still incomplete. Counts are a snapshot,
not the final number of works in all 17 sites. Artworks, author pages, guides and
contest indexes remain outside the collection scope.
