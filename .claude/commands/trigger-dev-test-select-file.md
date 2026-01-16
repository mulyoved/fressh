# How to Update Test File in .trigger-dev-test.json

## Quick Steps

1. **Open** `.trigger-dev-test.json`

2. **Find your test file** in `app/src/server/integrations/test-runner/samples/`

3. **Copy the path** starting from the samples folder (don't include `app/src/server/integrations/test-runner/samples/`)

4. **Replace** the `testFileName` value

5. **Save** and run `yarn td:run-test`

## Example

If you want to run the test `quickbooks-core8-basic-sync-3700-s1.yaml`:

1. Find it at: `app/src/server/integrations/test-runner/samples/quickbooks/gap-report/quickbooks-core8-basic-sync-3700-s1.yaml`

2. Update `.trigger-dev-test.json`:
   ```json
   {
     "organizationId": "6115544",
     "testFileName": "quickbooks/gap-report/quickbooks-core8-basic-sync-3700-s1.yaml",
     "userId": "c7ea5675-8886-4aa3-9301-1a6a15f4905d"
   }
   ```

## Common Paths

- QuickBooks: `quickbooks/*.yaml` or `quickbooks/gap-report/*.yaml`
- Stripe: `stripe/*.yaml` or `stripe/3808-full-testing/*.yaml`
- NetSuite: `netsuite/*.yaml`
- HubSpot: `hubspot/*.yaml`
- Green Invoice: `green-invoice/*.yaml`
