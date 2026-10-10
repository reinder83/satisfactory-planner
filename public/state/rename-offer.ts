// The "Rename to …" offer's stored half (#1071), in both editions. A profile created before
// #1105 without a typed name carries its goal's name ("Balanced progression"); Saves & profiles
// offers such a card the descriptive name a new profile gets (renameOffers in
// app/profile-edit.ts). Accepting is an ordinary rename (/api/rename) and stores nothing else.
// Dismissing stores the optional profile field `renameOfferDismissed` (POST
// /api/dismiss-rename-offer), so the offer does not come back. Re-exported by ../state.ts.
//
// The field is `true` or absent: absent from every profile stored before it and from every
// profile whose offer was never dismissed. It is no progress, so it needs no state version:
// older releases keep it in their stores without reading it and leave it out of what they import
// (validateTransfer rebuilds each profile), which only brings the offer back. A full export, an
// import and a one-profile export keep it; Duplicate, a recalculation's backup and the version a
// restore replaces leave it behind, since each gets a name of its own.

// What a profile's entry in the save list (summary() in server/scope.ts, browser-api.ts) and a
// full export add for the offer: `renameOfferDismissed: true` once it was dismissed, else nothing.
// Any other stored value is left out.
export const renameOfferFields = (profile: {
  renameOfferDismissed?: unknown;
}): { renameOfferDismissed?: true } =>
  profile.renameOfferDismissed === true ? { renameOfferDismissed: true } : {};

// A copy of `profile` without the flag: the profile a recalculation keeps as its backup and the
// version a restore replaces are named anew, so the offer the user dismissed was not theirs.
export function withoutRenameOffer<T extends { renameOfferDismissed?: unknown }>(
  profile: T,
): Omit<T, 'renameOfferDismissed'> {
  const { renameOfferDismissed: _dismissed, ...rest } = profile;
  return rest;
}
