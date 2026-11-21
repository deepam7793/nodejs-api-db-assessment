"use strict";

function apiEvent({ pathParameters = null, body, headers = {} } = {}) {
  let rawBody = null;
  if (body !== undefined) {
    rawBody = typeof body === "string" ? body : JSON.stringify(body);
  }
  return {
    pathParameters,
    headers,
    body: rawBody,
    isBase64Encoded: false,
    requestContext: { requestId: "test-request-id" },
  };
}

async function invoke(handler, event) {
  const response = await handler(event, {});
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.parse(response.body),
  };
}

module.exports = {
  apiEvent,
  invoke,
};
