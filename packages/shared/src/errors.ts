export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAVAILABLE"
  | "RATE_LIMITED"
  | "INTERNAL";

export class FlutterError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "FlutterError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static validation(message: string, details?: unknown) {
    return new FlutterError("VALIDATION", message, 400, details);
  }

  static unauthorized(message = "Unauthorized") {
    return new FlutterError("UNAUTHORIZED", message, 401);
  }

  static forbidden(message = "Forbidden") {
    return new FlutterError("FORBIDDEN", message, 403);
  }

  static notFound(message = "Not found") {
    return new FlutterError("NOT_FOUND", message, 404);
  }

  static conflict(message: string) {
    return new FlutterError("CONFLICT", message, 409);
  }

  static unavailable(message = "Node daemon is offline") {
    return new FlutterError("UNAVAILABLE", message, 503);
  }
}

export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
  requestId: string;
};
