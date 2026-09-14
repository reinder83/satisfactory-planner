# Third-party notices

Storage item icons are Satisfactory game artwork belonging to Coffee Stain Studios, obtained from the Official Satisfactory Wiki (https://satisfactory.wiki.gg/wiki/Category:Item_icons) for this unofficial planner. They are bundled locally so visitors do not contact the wiki to load them. `public/icons/sources.json` records the file description and image source URL for each icon; this artwork is not covered by the solver's MIT license.

The interface bundles two typefaces as self-hosted WOFF2 files in `public/fonts/`, both licensed under the SIL Open Font License 1.1: Saira Condensed (weights 600/700, copyright the Saira Project Authors, https://github.com/Omnibus-Type/Saira) and IBM Plex Mono (weights 400/600, copyright IBM Corp., https://github.com/IBM/plex). The files were obtained from Google Fonts (latin subset). No fonts are loaded from external servers at runtime.

The vendored HiGHS JavaScript/WebAssembly solver is `highs` 1.15.3 (MIT), from https://github.com/lovasoa/highs-js, distributed through the official npm registry. The license is in `vendor/HIGHS-LICENSE`. Its release archive was verified against the npm SHA-512 integrity value before inclusion. No runtime download is needed.

Recipe data is derived from the Satisfactory Tools dataset at https://github.com/greeny/SatisfactoryTools. The dataset revision is recorded in `recipes.json`. Satisfactory game content belongs to Coffee Stain Studios. This is an unofficial planner.

Reference resource limits use the standard node counts, with crude oil wells excluded. Nitrogen is a separate configurable budget. Randomizer resource-rich settings can change counts and are not inferred from purity: confirm the per-resource budgets for the actual seed. Reference: https://satisfactory.wiki.gg/wiki/Resource_Node .
