export class ReviewDatabaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReviewDatabaseError";
  }
}

export class ReviewCommentConflictError extends Error {
  constructor() {
    super("That submission ID is already associated with another comment.");
    this.name = "ReviewCommentConflictError";
  }
}

export class ReviewStoreValidationError extends Error {
  constructor(field: string) {
    super(`Review store field "${field}" must not be empty.`);
    this.name = "ReviewStoreValidationError";
  }
}

export class ReviewStoreDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewStoreDataError";
  }
}

export class ReviewOutcomeRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewOutcomeRequestError";
  }
}
