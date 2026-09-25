export class ApiError extends Error {
  /** details: zusaetzliche Felder der Fehlerantwort, etwa eine bestaetigbare Warnung. */
  constructor(message: string, public status = 400, public details?: Record<string, unknown>) { super(message); }
}
