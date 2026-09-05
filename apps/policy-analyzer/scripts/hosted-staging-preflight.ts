/**
 * Prove or refuse a hosted staging migration target.
 * Never prints URLs, passwords, or keys.
 */
import { hostedStagingAuthFromEnv, evaluateHostedStagingTarget } from "../lib/deploy/hosted-staging-target";

function main(): void {
  const decision = evaluateHostedStagingTarget(hostedStagingAuthFromEnv());
  if (!decision.allowed) {
    console.error(`HOSTED_STAGING_TARGET_REFUSED:${decision.reason}`);
    console.error("STOP — DO NOT MIGRATE");
    process.exit(1);
  }
  console.log("HOSTED_STAGING_TARGET_OK");
  console.log(`reason=${decision.reason}`);
  console.log(`hostname=${decision.hostname}`);
}

main();
