import assert from "node:assert/strict";
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from "../src/lib/login-throttle";

const originalNow = Date.now;
let now = 1_800_000_000_000;
Date.now = () => now;

try {
  const email = "Throttle-Regression@akro-test.invalid";
  clearLoginFailures(email);

  for (let attempt = 0; attempt < 4; attempt++) recordLoginFailure(email);
  assert.equal(isLoginBlocked(email.toLowerCase()), false, "four failures remain allowed");
  recordLoginFailure(email);
  assert.equal(isLoginBlocked(email.toLowerCase()), true, "five failures trigger the 15-minute lockout");

  now += 15 * 60_000 + 1;
  assert.equal(isLoginBlocked(email), false, "the failure window expires after 15 minutes");
  recordLoginFailure(email);
  assert.equal(isLoginBlocked(email), false, "a new window starts after expiry");

  clearLoginFailures(email.toLowerCase());
  assert.equal(isLoginBlocked(email), false, "successful login reset clears failures");

  const burstEmail = "Throttle-Burst@akro-test.invalid";
  clearLoginFailures(burstEmail);
  const burstStart = now;
  for (let attempt = 0; attempt < 5; attempt++) {
    recordLoginFailure(burstEmail);
    now += 100;
  }
  assert.equal(isLoginBlocked(burstEmail), true, "parallel failure burst reaches the threshold");
  for (let attempt = 0; attempt < 50; attempt++) {
    now += 1_000;
    recordLoginFailure(burstEmail);
  }
  now = burstStart + 15 * 60_000 + 101;
  assert.equal(isLoginBlocked(burstEmail), false, "additional concurrent failures cannot grow storage or extend the lockout");
  console.log("PASS: bounded login throttle preserves the five-failure, 15-minute policy");
} finally {
  Date.now = originalNow;
}
