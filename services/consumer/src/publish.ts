interface PublishRetryOptions {
  attempts?: number;
  attemptTimeoutMs?: number;
  retryDelayMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}

const wait = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

async function withTimeout(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`redis publish exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Requirement 4.2 calls for three publish attempts without letting Redis hold
 * up the durable Kafka/Postgres path. The defaults cap the worst-case retry
 * schedule at 425ms (3 × 125ms + 2 × 25ms), inside the 500ms notification
 * budget from Requirement 4.1.
 */
export async function publishWithRetry(
  publish: () => Promise<unknown>,
  options: PublishRetryOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? 3;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 125;
  const retryDelayMs = options.retryDelayMs ?? 25;
  const waitFor = options.wait ?? wait;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await withTimeout(publish(), attemptTimeoutMs);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await waitFor(retryDelayMs);
    }
  }

  throw lastError;
}
