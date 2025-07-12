export abstract class AppError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: Error }) {
    super(message, { cause: options?.cause });
    this.name = new.target.name;

    if (!this.stack && Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }
}
