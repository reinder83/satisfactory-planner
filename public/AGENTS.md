# Frontend and redesign guide

Read `../AGENTS.md` first. This guide applies to files in `public/` and to interface redesigns. The goal is a polished, understandable planner that retains the working app's behavior and the owner's existing progress.

## Design freedom

You may redesign colors, typography, spacing, navigation, cards, tables, dialogs and responsive layouts. The current visual style is not a requirement. Prefer familiar labels and clear hierarchy over exposing solver or implementation terminology. Show useful production numbers with units and retain access to detailed inputs, outputs, machine counts and expansion steps.

Use the current vanilla HTML/CSS/JS structure unless the requested scope warrants an architectural migration. A framework migration must retain both runtime modes, static hosting, save compatibility and functional coverage; do not introduce one merely to reskin the interface.

## Functional inventory — retain these flows

- Create a named save; use the five-step settings/preferences/goals/resources/review wizard. Top step tabs are clickable, edits survive navigation, and Review recalculates when needed.
- Select, rename and remove profiles with confirmation. Switching profiles preserves each one's progress. The active-save header/footer must reflect the selected profile rather than the owner's original settings.
- View chronological guidance for Phases 1–5 and post-game, check tasks, record deliveries, save notes and manage custom tasks.
- Find/filter factories; inspect machine counts, rates, inputs, surplus, expansion and unlock guidance. Preserve the difference between original and calculated plans.
- View the selected storage contract, labeled container locations, floors and collectables/workshop guidance. Existing storage addresses matter to a physically built game layout.
- Review resource budgets, feasibility, power headroom, transport allowance and fuel requirements.
- Export/import full saves in both editions. Preserve progress-only backups where currently supported. Import confirmation must explain whether it adds copies or replaces progress.
- In Docker, retain account setup/login/logout and user isolation. In browser mode, show local-storage and backup information instead of server/account claims.
- Retain error, loading, empty-workspace, infeasible-result and calculation-in-progress states. Never show a successful save after a failed write.

## Implementation constraints

`app.js` uses hash routes (`#plan`, `#factories`, `#storage`, `#resources`, `#backup`, `#profiles`, `#wizard`, `#account`) and delegated events. Preserve working deep links. Keep `data-*` action hooks and form field names compatible or update all handlers and tests together. Checklist IDs and saved data keys are not visual implementation details: keep them stable.

Use the shared request path and browser API adapter. Do not bypass them with localStorage, cookies, new server calls or hardcoded profile state. Keep calculation in the browser worker for the public version, and preserve transactional saves and explicit profile scope across tabs.

The public deployment is under `/satisfactory-planner/`, while Docker serves `/`. Use URLs that work in both environments. Update the build allowlist for new fonts, icons, scripts or images; never fix only `dist/`. Avoid external CDNs and trackers for ordinary presentation assets. Keep third-party licenses and asset attribution.

User-provided names, notes, tasks and imported values are untrusted text. Continue escaping them before HTML rendering. Use safe URL handling for imported links. Preserve keyboard operation, visible focus, labels, semantic buttons, dialog dismissal/focus handling and readable contrast. Tooltips must work without a mouse and must not be obscured by duplicate native `title` tooltips. Do not use `alt` as a tooltip substitute; meaningful image alt text still belongs on images.

Show MW below 1,000 MW and GW where appropriate above that. For machine instructions distinguish total machines, full-speed machines and any adjustable machine, with output rate alongside clock percentage. Honor calculated whole-machine/surplus settings instead of changing the math for visual neatness.

## Redesign verification

1. Read the existing UI and capture its functional inventory before replacing large sections.
2. Inspect both an original handbook and a newly calculated profile. Use isolated test data or imported copies; do not experiment on the owner's live workspace.
3. Run the root checks and browser integration test after functional changes. Add coverage for new behavior rather than assertions that merely repeat CSS markup.
4. Inspect the rendered result at desktop and narrow/mobile widths: navigation, long item names, resource tables, dialogs, wizard controls and tooltips must remain usable.
5. Verify keyboard navigation, fresh start, profile switching, reload persistence, failed/invalid import feedback and successful full-save transfer. Test both server mode and a rebuilt static subpath preview.
6. Check there are no browser errors, broken assets, clipped controls or misleading save indicators. A successful Node test is not visual QA.

Keep redesign changes focused on presentation unless the user requested planning changes. Document any deliberate behavior or architecture change in the handoff and update the root guide if necessary.
