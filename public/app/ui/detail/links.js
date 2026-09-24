// A link to another factory's dialog, as the flow models and the group chain carry it:
// { factory: <handbook id> } or { calcFactory: <calculated row id> }. Bound with v-bind, it
// gives the button the data-factory or data-calc-factory attribute that the shared click
// handlers in events/views.js open (they also serve the storage page and the plan).
export const linkAttrs = link =>
  !link
    ? {}
    : link.calcFactory
      ? { 'data-calc-factory': link.calcFactory }
      : { 'data-factory': link.factory };
