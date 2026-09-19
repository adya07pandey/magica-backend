export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(
    message: string,
    statusCode: number,
    code: string,
  ) {
    super(message);

    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ---------------------------------------------------------
// 400
// ---------------------------------------------------------

export class ValidationError extends AppError {
  constructor(message = "Invalid request") {
    super(message, 400, "VALIDATION_ERROR");
  }
}

// ---------------------------------------------------------
// 401
// ---------------------------------------------------------

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

// ---------------------------------------------------------
// 403
// ---------------------------------------------------------

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

// ---------------------------------------------------------
// 404
// ---------------------------------------------------------

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

// ---------------------------------------------------------
// 409
// ---------------------------------------------------------

export class ConflictError extends AppError {
  constructor(
    message = "Resource conflict",
    code = "CONFLICT",
  ) {
    super(message, 409, code);
  }
}

export class IdempotencyConflictError extends ConflictError {
  constructor() {
    super(
      "Idempotency key belongs to another operation",
      "IDEMPOTENCY_CONFLICT",
    );
  }
}

export class ActiveRunError extends ConflictError {
  constructor(
    runId?: string,
    status?: string,
  ) {
    super(
      "Task already has an active agent run",
      "ACTIVE_RUN",
    );

    this.runId = runId;
    this.runStatus = status;
  }

  public readonly runId?: string;
  public readonly runStatus?: string;
}

// ---------------------------------------------------------
// 429
// ---------------------------------------------------------

export class RateLimitError extends AppError {
  constructor(message = "Too many requests") {
    super(message, 429, "RATE_LIMITED");
  }
}

// ---------------------------------------------------------
// 500
// ---------------------------------------------------------

export class InternalServerError extends AppError {
  constructor(message = "Internal server error") {
    super(message, 500, "INTERNAL_SERVER_ERROR");
  }
}