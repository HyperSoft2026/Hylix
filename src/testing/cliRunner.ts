import { runArchitectureVerificationSuite } from './foundationVerification';
import { HYLIX_IDENTITY } from '../core/engineIdentity';

/**
 * CLI Verification Runner (`npm test`)
 * Executes all runtime architectural, security, signing, and storage checks.
 */
function runCliVerification(): void {
  const report = runArchitectureVerificationSuite();

  console.log('======================================================================');
  console.log(
    `HYLIX V${HYLIX_IDENTITY.version} (${HYLIX_IDENTITY.androidApplicationId}) — ARCHITECTURE FOUNDATION VERIFICATION`
  );
  console.log('======================================================================');

  for (const item of report.results) {
    const status = item.passed ? '[PASS]' : '[FAIL]';
    console.log(`${status} [${item.category}] ${item.title}`);
    console.log(`       ${item.details}`);
  }

  console.log('----------------------------------------------------------------------');
  console.log(
    `Result: ${report.passedChecks}/${report.totalChecks} architectural assertions passed.`
  );

  if (!report.allPassed) {
    throw new Error(
      `Architecture verification failed with ${report.failedChecks} failing check(s).`
    );
  }
}

runCliVerification();
