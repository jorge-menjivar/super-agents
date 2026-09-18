import { test as base } from '@playwright/test';
import { cleanUp } from './cleanup';

/** Worker-scoped fixtures this suite adds to Playwright's own. */
interface SuiteWorkerFixtures {
  /**
   * Nothing a test reads -- it exists for its teardown. `null` rather than
   * `void` so the type says "no value" without being a confusing one.
   */
  workerCleanup: null;
}

/**
 * The suite's `test`: Playwright's, with one thing added. When a worker
 * finishes, everything it made is unmade -- its agents, the models and
 * providers they answered through, and the singleton settings row, which is
 * restored to what the worker found rather than left holding the stub's
 * models.
 *
 * Specs still undo their own where it is natural to. This is the backstop
 * for what they cannot: a row made in a `beforeAll`, a spec that simply
 * forgets, a test that failed before reaching its `finally`.
 *
 * Worker-scoped rather than a `globalTeardown`, because the registry lives in
 * the worker process that made the rows and a teardown project runs somewhere
 * else, with nothing to read. It also runs while the servers are certainly
 * still up.
 *
 * `auto`, so importing this `test` is the whole of it: nothing for a spec to
 * remember, which is the point.
 */
export const test = base.extend<object, SuiteWorkerFixtures>({
  workerCleanup: [
    // `playwright` rather than nothing: the fixture list has to be a
    // destructuring pattern, and this is the one worker-scoped fixture that
    // costs nothing to ask for -- a browser would be launched in every
    // worker, including the API-only projects.
    async ({ playwright }, use, workerInfo) => {
      await use(null);

      const baseURL = workerInfo.project.use.baseURL;
      if (!baseURL) return;

      // A context of its own: the test-scoped `request` is long gone by the
      // time a worker is tearing down.
      const context = await playwright.request.newContext({ baseURL });
      try {
        const swept = await cleanUp(context);
        const left = [
          [swept.agents, 'agent'],
          [swept.models, 'model'],
          [swept.providers, 'provider'],
        ] as const;
        const listed = left
          .filter(([count]) => count > 0)
          .map(([count, what]) => `${count} ${what}${count === 1 ? '' : 's'}`);
        if (listed.length > 0) {
          console.warn(
            `[e2e] ${workerInfo.project.name}: swept ${listed.join(', ')} ` +
              'a spec left behind',
          );
        }
      } finally {
        await context.dispose();
      }
    },
    { scope: 'worker', auto: true },
  ],
});

export { expect } from '@playwright/test';
