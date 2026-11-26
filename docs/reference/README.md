# Reference corpus

`sources.json` pins the official Roland S-1 Owner's Manual (URL + SHA-256). The page-anchored
markdown that `scripts/validate-tips.mjs` checks quotes against is generated into
`docs/reference/<slug>/` by:

```sh
npm run docs:sync
```

The generated text is git-ignored because the manual is Roland's copyrighted work; `tips.json`
only carries short, cited quotes. `npm run check` runs the sync automatically.
