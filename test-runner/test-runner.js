"use strict";

// Shared browser test harness used by all extension projects.

(() => {
  const tests = [];
  const infrastructureErrors = [];

  window.addEventListener("error", (event) => {
    if (event.target instanceof HTMLScriptElement) {
      infrastructureErrors.push(new Error(`Failed to load script: ${event.target.src}`));
      return;
    }
    if (event.error) infrastructureErrors.push(event.error);
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    infrastructureErrors.push(event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
  });

  function test(name, execute) {
    if (typeof name !== "string" || !name.trim()) {
      throw new TypeError("Test name must be a non-empty string.");
    }
    if (typeof execute !== "function") {
      throw new TypeError(`Test "${name}" must provide a function.`);
    }
    tests.push({ name, execute });
  }

  function assert(condition, message = "Expected condition to be true.") {
    if (!condition) throw new Error(message);
  }

  function assertEqual(actual, expected, message) {
    if (!Object.is(actual, expected)) {
      throw new Error(message || `Expected ${String(expected)}, received ${String(actual)}.`);
    }
  }

  function renderResult(list, result) {
    const item = document.createElement("li");
    item.dataset.testStatus = result.passed ? "passed" : "failed";
    item.dataset.testName = result.name;
    item.textContent = `${result.passed ? "✅" : "❌"} ${result.name}`;

    if (result.error) {
      const details = document.createElement("pre");
      details.dataset.testError = "true";
      details.textContent = result.error.stack || result.error.message || String(result.error);
      item.append(details);
    }

    list.append(item);
  }

  async function run() {
    const root = document.documentElement;
    const summary = document.querySelector("#summary");
    const list = document.querySelector("#results");
    root.dataset.testStatus = "running";
    root.dataset.testComplete = "false";
    delete root.dataset.testInfrastructureError;
    summary.textContent = `Running ${tests.length} tests…`;

    let passed = 0;
    for (const current of tests) {
      try {
        await current.execute();
        passed += 1;
        renderResult(list, { name: current.name, passed: true });
        console.log(`PASS ${current.name}`);
      } catch (error) {
        renderResult(list, { name: current.name, passed: false, error });
        console.error(`FAIL ${current.name}`, error);
      }
    }

    for (const error of infrastructureErrors) {
      renderResult(list, { name: "Test infrastructure loaded without script errors", passed: false, error });
    }

    const total = tests.length + infrastructureErrors.length;
    const failed = total - passed;
    if (infrastructureErrors.length) {
      root.dataset.testInfrastructureError = infrastructureErrors
        .map((error) => error.stack || error.message || String(error))
        .join("\n\n");
    }
    root.dataset.testStatus = failed === 0 ? "passed" : "failed";
    root.dataset.testComplete = "true";
    summary.textContent = `${passed} passed, ${failed} failed, ${total} total.`;
  }

  globalThis.TestHarness = Object.freeze({ assert, assertEqual, test });
  window.addEventListener("load", () => void run(), { once: true });
})();
