// The numbers read as in en-US, whatever this machine's locale is ("44.43 GW", not "44,43 GW"),
// as on the CI runners: Number.prototype.toLocaleString and Intl.NumberFormat called without a
// locale, as the pages call them, use en-US. Since #1060 the pages format numbers with one
// Intl.NumberFormat per digit count (localeNumber in public/wording.ts), so pinning
// toLocaleString alone no longer reaches them. Every component test loads this first
// (setupFiles in vite.config.ts); a Node test that compares formatted numbers imports it first.
const toLocale = Number.prototype.toLocaleString;
Number.prototype.toLocaleString = function (
  this: number,
  locales?: Intl.LocalesArgument,
  options?: Intl.NumberFormatOptions,
) {
  return toLocale.call(this, locales ?? 'en-US', options);
};
const NumberFormat = Intl.NumberFormat;
class EnUsNumberFormat extends NumberFormat {
  constructor(locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
    super(locales ?? 'en-US', options);
  }
}
Object.defineProperty(Intl, 'NumberFormat', {
  value: EnUsNumberFormat,
  configurable: true,
  writable: true,
});
