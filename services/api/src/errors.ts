// Distinguishes "the caller sent something we can't act on" (400) from
// "something on our side broke" (500). Before this, every thrown error in
// the query path became a 400 - including a genuine database outage, which
// is exactly the kind of infrastructure failure a health/status check
// should surface, not mask as a client mistake.
export class ValidationError extends Error {}
