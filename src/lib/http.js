"use strict";

const { AppError, badRequest } = require("./errors");
const { json, serverError } = require("./response");

function withErrorHandling(handlerName, fn) {
  return async (event = {}, context = {}) => {
    try {
      return await fn(event, context);
    } catch (err) {
      if (err instanceof AppError) {
        return json(err.statusCode, { error: err.error, message: err.message });
      }

      // Log full details for operators; never expose internals to the client.
      console.error(
        JSON.stringify({
          level: "error",
          handler: handlerName,
          requestId: context.awsRequestId || event.requestContext?.requestId,
          error: err?.name,
          message: err?.message,
          stack: err?.stack,
        }),
      );
      return serverError();
    }
  };
}

function readJsonBody(event) {
  const { body } = event;
  if (body === undefined || body === null || body === "") {
    throw badRequest("Request body is required");
  }

  let data;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw badRequest("Request body must be valid JSON");
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw badRequest("Request body must be a JSON object");
  }
  return data;
}

function readPathParam(event, name) {
  const value = event.pathParameters?.[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`${name} path parameter is required`);
  }
  return value;
}

function readHeader(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : headers[key];
}

module.exports = {
  withErrorHandling,
  readJsonBody,
  readPathParam,
  readHeader,
};
