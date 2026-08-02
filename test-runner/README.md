# Shared browser test runner

Run a product test suite by passing its repository root:

```sh
./run-tests.sh /path/to/extension-project
```

The product must provide `tests/index.html`. The runner serves the product on a temporary localhost and exposes the shared browser harness at `/__test-runner__/test-runner.js`.

Exit codes:

- `0`: tests passed;
- `1`: tests failed;
- `2`: runner infrastructure failed.

The command prints one JSON object containing `passed`, `status`, `summary`, `failedTests`, and `infrastructureError`.
