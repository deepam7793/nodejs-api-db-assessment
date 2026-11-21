"use strict";

const {
  validateCreateCustomer,
  validateCreateAccount,
  validateAmountRequest,
  validateTransferRequest,
  validateIdempotencyKey,
} = require("../../src/lib/validation");

function expectBadRequest(fn, message) {
  expect(fn).toThrow(expect.objectContaining({ statusCode: 400, error: "BAD_REQUEST" }));
  expect(fn).toThrow(message);
}

describe("validateCreateCustomer", () => {
  it("trims the name and lowercases the email", () => {
    expect(
      validateCreateCustomer({ fullName: "  Ada Lovelace ", email: " Ada@Example.COM " }),
    ).toEqual({ fullName: "Ada Lovelace", email: "ada@example.com" });
  });

  it.each([
    [{ email: "a@b.co" }, "fullName is required"],
    [{ fullName: "   ", email: "a@b.co" }, "fullName must not be empty"],
    [{ fullName: 42, email: "a@b.co" }, "fullName must be a string"],
    [{ fullName: "Ada" }, "email is required"],
    [{ fullName: "Ada", email: "not-an-email" }, "valid email"],
  ])("rejects %j", (body, message) => {
    expectBadRequest(() => validateCreateCustomer(body), message);
  });
});

describe("validateCreateAccount", () => {
  it("defaults initialBalance to 0", () => {
    expect(validateCreateAccount({ type: "CHECKING", currency: "CAD" })).toEqual({
      type: "CHECKING",
      currency: "CAD",
      initialBalance: 0,
    });
  });

  it.each([
    [{ currency: "CAD" }, "type is required"],
    [{ type: "CREDIT", currency: "CAD" }, "type must be one of"],
    [{ type: "SAVINGS", currency: "EUR" }, "currency must be one of"],
    [{ type: "SAVINGS", currency: "CAD", initialBalance: -1 }, "greater than or equal to 0"],
    [{ type: "SAVINGS", currency: "CAD", initialBalance: "100" }, "must be a number"],
    [{ type: "SAVINGS", currency: "CAD", initialBalance: 1.005 }, "2 decimal places"],
  ])("rejects %j", (body, message) => {
    expectBadRequest(() => validateCreateAccount(body), message);
  });
});

describe("validateAmountRequest", () => {
  it.each([0.01, 0.1, 0.29, 1.15, 10, 999999.99])("accepts %p", (amount) => {
    expect(validateAmountRequest({ amount, currency: "USD" }).amount).toBe(amount);
  });

  it.each([
    [0, "greater than 0"],
    [-5, "greater than 0"],
    [0.001, "2 decimal places"],
    ["10", "must be a number"],
    [Number.NaN, "must be a number"],
    [1e13, "must not exceed"],
  ])("rejects amount %p", (amount, message) => {
    expectBadRequest(() => validateAmountRequest({ amount, currency: "USD" }), message);
  });

  it("requires a currency", () => {
    expectBadRequest(() => validateAmountRequest({ amount: 5 }), "currency is required");
  });
});

describe("validateTransferRequest", () => {
  const valid = { fromAccountId: "acct_001", toAccountId: "acct_002", amount: 10, currency: "CAD" };

  it("accepts a valid transfer", () => {
    expect(validateTransferRequest(valid)).toEqual(valid);
  });

  it("rejects a transfer to the same account", () => {
    expectBadRequest(
      () => validateTransferRequest({ ...valid, toAccountId: "acct_001" }),
      "must be different",
    );
  });
});

describe("validateIdempotencyKey", () => {
  it("is optional", () => {
    expect(validateIdempotencyKey(undefined)).toBeUndefined();
  });

  it("rejects keys longer than 36 characters", () => {
    expectBadRequest(() => validateIdempotencyKey("x".repeat(37)), "Idempotency-Key");
  });
});
