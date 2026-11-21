# Notes

All core and stretch endpoints are implemented against `openapi/openapi.yaml`.

```bash
npm run setup && npm start      # API on http://localhost:3000
npm test                        # unit tests (DynamoDB mocked, no Docker needed)
npm run test:integration        # against DynamoDB Local (needs `npm run db:up`)
```

## Structure

| Layer | Where | Responsibility |
|---|---|---|
| Routes | `serverless.yml` | path + method → handler (API Gateway does the routing) |
| Controllers | `src/handlers/` | parse and validate the event, return the HTTP response |
| Services | `src/services/` | business rules, map DynamoDB outcomes to 400 / 404 / 409 |
| Repositories | `src/repositories/` | every DynamoDB call |

Each handler is wrapped so errors always use the contract's `{ error, message }` shape. Unexpected errors are logged and returned as a generic 500.

## DynamoDB access patterns

| Use case | Operation |
|---|---|
| Get customer / account | `GetItem` on the partition key, `ConsistentRead` |
| Create customer | `PutItem` with `attribute_not_exists` (never overwrites) |
| Create account | `TransactWriteItems`: `ConditionCheck` that the customer exists + `Put` the account, atomically |
| List a customer's accounts | `Query` on GSI `CustomerIdIndex`, following `LastEvaluatedKey`. No `Scan`: a Scan reads the whole table. |

GSI reads are eventually consistent, so a just-created account can take a moment to appear in the list.

## Balance consistency

- **Deposit / withdraw:** one conditional `UpdateItem`, e.g. `SET balance = balance - :amount` only if the account exists, is `OPEN`, the currency matches and `balance >= :amount`. There is no read-then-write, so concurrent withdrawals can't overdraw. The maths runs inside DynamoDB, which keeps decimals exact.
- **Transfer and partial failure:** one `TransactWriteItems` call holding both conditional updates (debit + credit). It is all-or-nothing, so a partial transfer can't happen: if any condition fails or the Lambda crashes, neither balance changes and nothing needs rolling back.
- **Error mapping:** DynamoDB doesn't say which condition failed, so the account(s) are re-read: missing → 404, currency mismatch → 400, insufficient funds → 409. If nothing is wrong on re-read, the state changed concurrently and a retryable 409 is returned.
- **Retries:** an optional `Idempotency-Key` header becomes the transaction's `ClientRequestToken`, so a transfer retried within 10 minutes doesn't move money twice. The update therefore carries no per-request values such as timestamps, which would make a retry look like a different request.
- Integration tests cover concurrent withdrawals (never negative), concurrent two-way transfers (total conserved), rejected transfers (nothing changes) and idempotent retries.

## Trade-offs / next steps

- No transaction ledger. In production I'd write an immutable transaction record in the same `TransactWriteItems`, for audit and statements.
- Deposits and withdrawals aren't idempotent (`ClientRequestToken` only covers transactions). I'd add an idempotency record with a TTL.
- Email uniqueness isn't enforced, because the contract defines no 409 for `POST /customers`.
- The list returns all accounts, because the contract has no pagination fields.
- Balances stay decimal to match the contract. A larger system would store integer cents.
- IAM in `serverless.yml` is narrowed to the actions and tables actually used.
