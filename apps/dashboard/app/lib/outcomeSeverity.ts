import { outcomesOfSeverity, type OutcomeCode, type OutcomeSeverity } from "@nymbus/shared";

const BANDS: OutcomeSeverity[] = ["approved", "soft_decline", "hard_decline"];

/**
 * The severity band a selection represents, or null if it is not exactly one
 * band.
 *
 * The severity control and the outcome bar chart write to the same filter, but
 * the chart can select a single code — narrower than any band. Reporting null
 * there keeps the control showing "All" instead of claiming a band that is not
 * actually selected; the chip row reports the real codes either way.
 */
export function severityOf(codes: readonly OutcomeCode[] | undefined): OutcomeSeverity | null {
  if (!codes || codes.length === 0) return null;
  const selected = new Set(codes);
  return (
    BANDS.find((band) => {
      const inBand = outcomesOfSeverity(band);
      return inBand.length === selected.size && inBand.every((code) => selected.has(code));
    }) ?? null
  );
}
